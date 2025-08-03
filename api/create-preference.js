import { MercadoPagoConfig, Preference } from 'mercadopago';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// --- Configuração Robusta do Firebase Admin ---
let db;
let firebaseInitializationError = null;

try {
    const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!serviceAccountString) {
        throw new Error("A chave da conta de serviço do Firebase não está configurada nas variáveis de ambiente.");
    }
    const serviceAccount = JSON.parse(serviceAccountString);

    if (!getApps().length) {
      initializeApp({
        credential: cert(serviceAccount)
      });
    }
    db = getFirestore();
} catch (e) {
    console.error("Erro na Inicialização do Firebase Admin:", e);
    firebaseInitializationError = e.message;
}
// -----------------------------------------

// --- ATUALIZADO: Preços de teste ---
const TICKET_PRICES = {
    pista: 0.01,
    vip: 0.02,
};
// ------------------------------------

export default async function handler(request, response) {
    // Verifica se o Firebase foi inicializado corretamente
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
        const { mainParticipant, ticket_type, quantity } = request.body;
        if (!mainParticipant || !ticket_type || !quantity) {
            return response.status(400).json({ error: 'Faltam dados obrigatórios' });
        }

        const unit_price = TICKET_PRICES[ticket_type];
        if (!unit_price) {
            return response.status(400).json({ error: 'Tipo de bilhete inválido' });
        }

        const inscriptionRef = await db.collection('inscriptions').add({
            mainParticipant,
            ticket_type,
            quantity,
            total_price: unit_price * quantity,
            paymentStatus: 'pending',
            createdAt: new Date().toISOString(),
        });

        const inscriptionId = inscriptionRef.id;

        const result = await preference.create({
            body: {
                items: [
                    {
                        title: `Bilhete ${ticket_type.toUpperCase()} - Resenha Music`,
                        quantity: Number(quantity),
                        unit_price: unit_price,
                        currency_id: 'BRL',
                    },
                ],
                payer: {
                    name: mainParticipant.name,
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
