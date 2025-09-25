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

async function findTicketExhaustively(ticketId) {
    const inscriptionsSnapshot = await db.collection('inscriptions').get();
    for (const inscDoc of inscriptionsSnapshot.docs) {
        const ticketRef = inscDoc.ref.collection('tickets').doc(ticketId);
        const ticketDoc = await ticketRef.get();
        if (ticketDoc.exists) {
            return {
                ticketDoc: ticketDoc,
                inscriptionDoc: inscDoc
            };
        }
    }
    return null;
}

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
        let inscriptionId = null;

        // ETAPA DE LIMPEZA E EXTRAÇÃO
        try {
            if (rawTicketId.includes('http')) {
                const url = new URL(rawTicketId);
                ticketId = url.searchParams.get('id');
                if (!ticketId) throw new Error('Parâmetro "id" não encontrado no URL.');
            }
        } catch (e) {
             return response.status(400).json({ status: 'invalid', message: `Formato de QR Code inválido: ${e.message}` });
        }
        
        if (ticketId.includes('_')) {
            [inscriptionId, ticketId] = ticketId.split('_');
        }

        let ticketDoc, inscriptionDoc;

        // Tenta encontrar pelo caminho direto (formato novo)
        if (inscriptionId) {
            const ticketRef = db.collection('inscriptions').doc(inscriptionId).collection('tickets').doc(ticketId);
            ticketDoc = await ticketRef.get();
            if(ticketDoc.exists) {
                inscriptionDoc = await ticketRef.parent.parent.get();
            }
        } else {
             // Tenta encontrar como inscrição principal (formato antigo)
            const inscriptionRef = db.collection('inscriptions').doc(ticketId);
            inscriptionDoc = await inscriptionRef.get();
            if(inscriptionDoc.exists){
                 // Se for formato antigo, a inscrição é o próprio bilhete
                 ticketDoc = inscriptionDoc;
            }
        }
        
        // Se não encontrou, faz a pesquisa exaustiva
        if (!ticketDoc || !ticketDoc.exists) {
            const result = await findTicketExhaustively(ticketId);
            if (result) {
                ticketDoc = result.ticketDoc;
                inscriptionDoc = result.inscriptionDoc;
            }
        }
        
        // Se ainda assim não encontrou, o bilhete não existe
        if (!ticketDoc || !ticketDoc.exists) {
            return response.status(404).json({ status: 'invalid', message: `Bilhete não encontrado para o ID: ${ticketId}` });
        }

        const ticketData = ticketDoc.data();
        const inscriptionData = inscriptionDoc.data();
        const participantName = ticketData.participantName || inscriptionData.mainParticipant.name;
        const ticketType = ticketData.ticketType || inscriptionData.ticket_type;

        if (inscriptionData.paymentStatus !== 'paid') {
            return response.status(403).json({ status: 'not_paid', message: 'Este bilhete não está pago.', participantName });
        }
        if (ticketData.isCheckedIn) {
            return response.status(409).json({ status: 'already_used', message: `BILHETE JÁ UTILIZADO em ${new Date(ticketData.checkedInAt).toLocaleString('pt-BR')}.`, participantName });
        }

        await ticketDoc.ref.update({ isCheckedIn: true, checkedInAt: new Date().toISOString() });
        return response.status(200).json({ status: 'success', message: 'ENTRADA VÁLIDA', participantName, ticketType });

    } catch (error) {
        console.error("[VALIDADOR] ERRO FATAL:", error);
        return response.status(500).json({ status: 'error', message: `Erro desconhecido no servidor. Detalhes: ${error.message}` });
    }
}

