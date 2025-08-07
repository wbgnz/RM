import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// --- Configuração do Firebase Admin ---
let db;
let firebaseInitializationError = null;
try {
    const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!serviceAccountString) throw new Error("A chave da conta de serviço do Firebase não está configurada.");
    const serviceAccount = JSON.parse(serviceAccountString);
    if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });
    db = getFirestore();
} catch (e) {
    console.error("Erro na Inicialização do Firebase Admin:", e);
    firebaseInitializationError = e.message;
}
// -----------------------------------------

export default async function handler(request, response) {
    if (firebaseInitializationError) {
        return response.status(500).json({ error: 'Falha na inicialização do servidor', details: firebaseInitializationError });
    }
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Método não permitido' });
    }

    try {
        const { mainParticipant, additionalParticipants, ticket_type, quantity, coupon } = request.body;
        if (!mainParticipant || !ticket_type || !quantity || !coupon) {
            return response.status(400).json({ error: 'Faltam dados obrigatórios para a solicitação de voucher.' });
        }

        // Validação de segurança: verifica se o cupão realmente dá 100% de desconto
        const couponRef = db.collection('coupons').doc(coupon.code);
        const doc = await couponRef.get();
        if (!doc.exists || doc.data().type !== 'percentage' || doc.data().value !== 100) {
            return response.status(403).json({ error: 'Este cupão não é válido para inscrição gratuita.' });
        }

        const inscriptionRef = db.collection('inscriptions').doc();
        const batch = db.batch();

        const mainTicketRef = inscriptionRef.collection('tickets').doc();
        batch.set(mainTicketRef, {
            participantName: mainParticipant.name,
            ticketType: ticket_type,
            status: 'awaiting_approval'
        });

        additionalParticipants.forEach(participant => {
            const additionalTicketRef = inscriptionRef.collection('tickets').doc();
            batch.set(additionalTicketRef, {
                participantName: participant.name,
                ticketType: ticket_type,
                status: 'awaiting_approval'
            });
        });

        batch.set(inscriptionRef, {
            mainParticipant,
            ticket_type,
            quantity,
            total_price: 0,
            appliedCoupon: coupon.code,
            discountValue: (99.90 * quantity), // Simula o valor do desconto
            paymentStatus: 'awaiting_approval', // NOVO ESTADO
            createdAt: new Date().toISOString(),
        });

        await batch.commit();
        
        return response.status(200).json({ success: true, message: 'Solicitação de inscrição recebida com sucesso.' });

    } catch (error) {
        console.error("Erro ao solicitar inscrição com voucher:", error);
        return response.status(500).json({ 
            error: 'Falha ao processar a sua solicitação.',
            details: error.message 
        });
    }
}
