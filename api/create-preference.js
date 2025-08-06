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
    pista: 99.90,
    vip: 149.90,
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
        const { mainParticipant, additionalParticipants, ticket_type, quantity, coupon } = request.body;
        if (!mainParticipant || !ticket_type || !quantity) {
            return response.status(400).json({ error: 'Faltam dados obrigatórios' });
        }

        let unit_price = TICKET_PRICES[ticket_type];
        if (!unit_price) {
            return response.status(400).json({ error: 'Tipo de bilhete inválido' });
        }

        let total_price = unit_price * quantity;
        let discount = 0;

        // NOVO: Valida e aplica o cupão no backend
        if (coupon && coupon.code) {
            const couponRef = db.collection('coupons').doc(coupon.code);
            const doc = await couponRef.get();

            if (doc.exists) {
                const couponData = doc.data();
                if (couponData.type === 'percentage') {
                    discount = total_price * (couponData.value / 100);
                } else if (couponData.type === 'fixed') {
                    discount = couponData.value;
                }
                total_price -= discount;
            }
        }

        const nameParts = mainParticipant.name.trim().split(' ');
        const firstName = nameParts.shift();
        const lastName = nameParts.join(' ') || firstName;

        const inscriptionRef = db.collection('inscriptions').doc();
        const inscriptionId = inscriptionRef.id;
        
        const batch = db.batch();

        const mainTicketRef = inscriptionRef.collection('tickets').doc();
        batch.set(mainTicketRef, {
            participantName: mainParticipant.name,
            ticketType: ticket_type,
            status: 'pending'
        });

        additionalParticipants.forEach(participant => {
            const additionalTicketRef = inscriptionRef.collection('tickets').doc();
            batch.set(additionalTicketRef, {
                participantName: participant.name,
                ticketType: ticket_type,
                status: 'pending'
            });
        });

        batch.set(inscriptionRef, {
            mainParticipant,
            ticket_type,
            quantity,
            total_price: Math.max(0, total_price), // Garante que o preço não é negativo
            appliedCoupon: coupon ? coupon.code : null,
            discountValue: discount,
            paymentStatus: 'pending',
            createdAt: new Date().toISOString(),
        });

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
                    unit_price: Math.max(0, total_price / quantity), // O preço unitário é o total com desconto a dividir pela quantidade
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
