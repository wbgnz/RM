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
        const { ticketId: rawTicketId } = request.body;
        if (!rawTicketId) {
            return response.status(400).json({ status: 'error', message: 'O ID do bilhete não foi fornecido.' });
        }

        let ticketId = rawTicketId;

        // ETAPA DE LIMPEZA: Verifica se o QR Code é um URL e extrai o ID
        try {
            if (rawTicketId.includes('http')) {
                const url = new URL(rawTicketId);
                const idFromParam = url.searchParams.get('id');
                if (!idFromParam) {
                    throw new Error('Parâmetro "id" não encontrado no URL do QR Code.');
                }
                ticketId = idFromParam;
            }
        } catch (e) {
             return response.status(400).json({ status: 'invalid', message: `Formato de QR Code inválido. Não foi possível extrair o ID. Detalhes: ${e.message}` });
        }

        // --- LÓGICA DE COMPATIBILIDADE ---
        if (ticketId.includes('_')) {
            // Lógica para o formato novo (inscriptionId_singleTicketId)
            const [inscriptionId, singleTicketId] = ticketId.split('_');
            const ticketRef = db.collection('inscriptions').doc(inscriptionId).collection('tickets').doc(singleTicketId);
            const ticketDoc = await ticketRef.get();

            if (!ticketDoc.exists) {
                return response.status(404).json({ status: 'invalid', message: `Bilhete (novo) não encontrado para o ID: ${ticketId}` });
            }

            const ticketData = ticketDoc.data();
            if (ticketData.isCheckedIn) {
                return response.status(409).json({ status: 'already_used', message: `BILHETE JÁ UTILIZADO em ${new Date(ticketData.checkedInAt).toLocaleString('pt-BR')}.`, participantName: ticketData.participantName });
            }

            await ticketRef.update({ isCheckedIn: true, checkedInAt: new Date().toISOString() });
            return response.status(200).json({ status: 'success', message: 'ENTRADA VÁLIDA', participantName: ticketData.participantName, ticketType: ticketData.ticketType });

        } else {
            // Lógica de fallback para o formato antigo (apenas inscriptionId)
            const inscriptionRef = db.collection('inscriptions').doc(ticketId);
            const inscriptionDoc = await inscriptionRef.get();

            if (inscriptionDoc.exists) {
                const inscriptionData = inscriptionDoc.data();
                if (inscriptionData.paymentStatus !== 'paid') {
                     return response.status(403).json({ status: 'not_paid', message: 'Este bilhete não está pago.', participantName: inscriptionData.mainParticipant.name });
                }
                if (inscriptionData.isCheckedIn) {
                    return response.status(409).json({ status: 'already_used', message: `BILHETE (ANTIGO) JÁ UTILIZADO em ${new Date(inscriptionData.checkedInAt).toLocaleString('pt-BR')}.`, participantName: inscriptionData.mainParticipant.name });
                }
                await inscriptionRef.update({ isCheckedIn: true, checkedInAt: new Date().toISOString() });
                return response.status(200).json({ status: 'success', message: 'ENTRADA VÁLIDA (Formato Antigo)', participantName: inscriptionData.mainParticipant.name, ticketType: inscriptionData.ticket_type });
            }

            // Lógica de fallback para o formato com apenas o ID do bilhete individual
            const ticketsQuery = db.collectionGroup('tickets').where('__name__', '==', `inscriptions/${ticketId.substring(0,20)}/tickets/${ticketId}`);
            const querySnapshot = await ticketsQuery.get();

            if (!querySnapshot.empty) {
                const ticketDoc = querySnapshot.docs[0];
                const ticketData = ticketDoc.data();
                const ticketRef = ticketDoc.ref;

                const parentInscriptionDoc = await ticketRef.parent.parent.get();
                if (!parentInscriptionDoc.exists || parentInscriptionDoc.data().paymentStatus !== 'paid') {
                     return response.status(403).json({ status: 'not_paid', message: 'A compra deste bilhete não foi paga.', participantName: ticketData.participantName });
                }

                if (ticketData.isCheckedIn) {
                    return response.status(409).json({ status: 'already_used', message: `BILHETE JÁ UTILIZADO em ${new Date(ticketData.checkedInAt).toLocaleString('pt-BR')}.`, participantName: ticketData.participantName });
                }

                await ticketRef.update({ isCheckedIn: true, checkedInAt: new Date().toISOString() });
                return response.status(200).json({ status: 'success', message: 'ENTRADA VÁLIDA', participantName: ticketData.participantName, ticketType: ticketData.ticketType });
            }
            
            // Se chegámos aqui, o ID não foi encontrado em nenhum formato.
            return response.status(404).json({ status: 'invalid', message: `Bilhete não encontrado para o ID: ${ticketId}` });
        }

    } catch (error) {
        console.error("[VALIDADOR] ERRO FATAL:", error);
        return response.status(500).json({ status: 'error', message: `Erro desconhecido no servidor. Detalhes: ${error.message}` });
    }
}

