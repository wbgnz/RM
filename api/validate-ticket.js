import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// --- Configuração do Firebase Admin ---
let db;
let firebaseInitializationError = null;
try {
    const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!serviceAccountString) throw new Error("A chave da conta de serviço do Firebase não está configurada.");
    const serviceAccount = JSON.parse(serviceAccountString);
    if (!getApps().length) {
        initializeApp({ credential: cert(serviceAccount) });
    }
    db = getFirestore();
} catch (e) {
    console.error("CRÍTICO: A inicialização do Firebase Admin falhou:", e);
    firebaseInitializationError = e.message;
}
// -----------------------------------------

export default async function handler(request, response) {
    if (firebaseInitializationError) {
        return response.status(500).json({ status: 'error', message: 'Falha na inicialização do servidor.' });
    }
    if (request.method !== 'POST') {
        return response.status(405).json({ status: 'error', message: 'Método não permitido.' });
    }

    try {
        const { ticketId } = request.body;
        if (!ticketId) {
            return response.status(400).json({ status: 'error', message: 'O ID do bilhete não foi fornecido.' });
        }

        // --- LÓGICA DE COMPATIBILIDADE ---
        // Verifica se o QR Code está no formato novo (com '_') ou antigo
        if (ticketId.includes('_')) {
            // Lógica para o formato novo (inscriptionId_singleTicketId)
            const [inscriptionId, singleTicketId] = ticketId.split('_');
            const ticketRef = db.collection('inscriptions').doc(inscriptionId).collection('tickets').doc(singleTicketId);
            const ticketDoc = await ticketRef.get();

            if (!ticketDoc.exists) {
                return response.status(404).json({ status: 'invalid', message: 'Bilhete (novo formato) não encontrado.' });
            }

            const ticketData = ticketDoc.data();
            if (ticketData.isCheckedIn) {
                return response.status(409).json({ status: 'already_used', message: `BILHETE JÁ UTILIZADO em ${new Date(ticketData.checkedInAt).toLocaleString('pt-BR')}.`, participantName: ticketData.participantName });
            }

            await ticketRef.update({ isCheckedIn: true, checkedInAt: new Date().toISOString() });
            return response.status(200).json({ status: 'success', message: 'ENTRADA VÁLIDA', participantName: ticketData.participantName, ticketType: ticketData.ticketType });

        } else {
            // Lógica de fallback para o formato antigo (apenas inscriptionId)
            const inscriptionId = ticketId;
            const inscriptionRef = db.collection('inscriptions').doc(inscriptionId);
            const ticketsSnapshot = await inscriptionRef.collection('tickets').limit(1).get();

            if (ticketsSnapshot.empty) {
                return response.status(404).json({ status: 'invalid', message: 'Bilhete (formato antigo) não encontrado.' });
            }

            const firstTicketDoc = ticketsSnapshot.docs[0];
            const firstTicketData = firstTicketDoc.data();

            if (firstTicketData.isCheckedIn) {
                return response.status(409).json({ status: 'already_used', message: `BILHETE JÁ UTILIZADO em ${new Date(firstTicketData.checkedInAt).toLocaleString('pt-BR')}.`, participantName: firstTicketData.participantName });
            }

            await firstTicketDoc.ref.update({ isCheckedIn: true, checkedInAt: new Date().toISOString() });
            return response.status(200).json({ status: 'success', message: 'ENTRADA VÁLIDA', participantName: firstTicketData.participantName, ticketType: firstTicketData.ticketType });
        }

    } catch (error) {
        console.error("[VALIDADOR] ERRO FATAL:", error);
        return response.status(500).json({ status: 'error', message: `Erro desconhecido no servidor. Detalhes: ${error.message}` });
    }
}

