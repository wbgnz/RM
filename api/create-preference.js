import { MercadoPagoConfig, Preference } from 'mercadopago';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// --- Configuração do Firebase Admin ---
let db;
let firebaseInitializationError = null;
try {
    const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!serviceAccountString) {
        throw new Error("A chave da conta de serviço do Firebase não está configurada.");
    }
    const serviceAccount = JSON.parse(serviceAccountString);
    if (!getApps().length) {
      initializeApp({ credential: cert(serviceAccount) });
    }
    db = getFirestore();
} catch (e) {
    console.error("Erro na Inicialização do Firebase Admin:", e);
    firebaseInitializationError = e.message;
}
// -----------------------------------------

const TICKET_PRICES = {
    pista: 1.00,
    vip: 2.00,
};

export default async function handler(request, response) {
    if (firebaseInitializationError) {
        return response.status(500).json({ error: 'Falha na inicialização do servidor', details: firebaseInitializationError });
    }
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Método não permitido' });
    }

    const accessToken = process.env.MP_ACCESS_TOKEN;
    if (!accessToken) {
        return response.status(500).json({ error: 'A chave de acesso do Mercado Pago não está configurada' });
    }

    const client = new MercadoPagoConfig({ accessToken });
    const preference = new Preference(client);

    try {
        const { mainParticipant, additionalParticipants, ticket_type, quantity } = request.body;
        if (!mainParticipant || !ticket_type || !quantity) {
            return response.status(400).json({ error: 'Faltam dados obrigatórios' });
        }

        const unit_price = TICKET_PRICES[ticket_type];
        if (!unit_price) {
            return response.status(400).json({ error: 'Tipo de bilhete inválido' });
        }

        const nameParts = mainParticipant.name.trim().split(' ');
        const firstName = nameParts.shift();
        const lastName = nameParts.join(' ') || firstName;

        // 1. Cria o documento principal da inscrição
        const inscriptionRef = db.collection('inscriptions').doc();
        const inscriptionId = inscriptionRef.id;
        
        // 2. Cria um "batch" para salvar todos os bilhetes de uma só vez
        const batch = db.batch();

        // Adiciona o bilhete do comprador principal
        const mainTicketRef = inscriptionRef.collection('tickets').doc();
        batch.set(mainTicketRef, {
            participantName: mainParticipant.name,
            ticketType: ticket_type,
            status: 'pending'
        });

        // Adiciona os bilhetes dos participantes adicionais
        additionalParticipants.forEach(participant => {
            const additionalTicketRef = inscriptionRef.collection('tickets').doc();
            batch.set(additionalTicketRef, {
                participantName: participant.name,
                ticketType: ticket_type,
                status: 'pending'
            });
        });

        // Salva o documento principal
        batch.set(inscriptionRef, {
            mainParticipant,
            ticket_type,
            quantity,
            total_price: unit_price * quantity,
            paymentStatus: 'pending',
            createdAt: new Date().toISOString(),
        });

        // Executa todas as operações de uma só vez
        await batch.commit();

        const result = await preference.create({
            body: {
                statement_descriptor: "Resenha Music",
                items: [{
                    id: ticket_type,
                    title: `Bilhete ${ticket_type.toUpperCase()} - Resenha Music`,
                    description: `Bilhete de acesso ao evento Resenha Music (${ticket_type})`,
                    category_id: 'tickets',
                    quantity: Number(quantity),
                    unit_price: unit_price,
                    currency_id: 'BRL',
                }],
                payer: {
                    name: firstName,
                    surname: lastName,
                    email: mainParticipant.email,
                    identification: {
                        type: 'CPF',
                        number: mainParticipant.cpf.replace(/\D/g, ''),
                    },
                },
                external_reference: inscriptionId,
                notification_url: `https://${request.headers.host}/api/webhook-mp`,
                back_urls: {
                    success: `https://${request.headers.host}/sucesso.html`,
                    failure: `https://${request.headers.host}/falha.html`,
                    pending: `https://${request.headers.host}/pendente.html`,
                },
                auto_return: 'approved',
            }
        });
        
        return response.status(200).json({
            id: result.id,
            init_point: result.init_point,
        });

    } catch (error) {
        console.error("Erro detalhado ao criar preferência:", JSON.stringify(error, null, 2));
        return response.status(500).json({ 
            error: 'Falha ao criar preferência no Mercado Pago.',
            details: error.cause ? error.cause : error.message 
        });
    }
}
