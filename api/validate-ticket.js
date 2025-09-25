import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// --- Configuração do Firebase Admin ---
let db;
try {
    const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!serviceAccountString) throw new Error("A chave da conta de serviço do Firebase não está configurada.");
    
    const serviceAccount = JSON.parse(serviceAccountString);
    if (!getApps().length) {
        initializeApp({ credential: cert(serviceAccount) });
    }
    db = getFirestore();
} catch (e) {
    console.error("Erro na Inicialização do Firebase Admin:", e);
}
// -----------------------------------------

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Método não permitido' });
    }

    if (!db) {
        return response.status(500).json({ error: 'A base de dados não está disponível.' });
    }

    const { ticketId } = request.body;

    if (!ticketId) {
        return response.status(400).json({ error: 'O ID do bilhete é obrigatório.' });
    }

    try {
        // O ID do bilhete contém o ID da inscrição e o ID do bilhete, separados por '_'
        const [inscriptionId, singleTicketId] = ticketId.split('_');

        if (!inscriptionId || !singleTicketId) {
             return response.status(400).json({ error: 'Formato de ID de bilhete inválido.' });
        }

        const ticketRef = db.collection('inscriptions').doc(inscriptionId).collection('tickets').doc(singleTicketId);
        const ticketDoc = await ticketRef.get();

        if (!ticketDoc.exists) {
            return response.status(404).json({ 
                status: 'invalid', 
                message: 'Bilhete não encontrado.' 
            });
        }

        const ticketData = ticketDoc.data();

        if (ticketData.isCheckedIn) {
            return response.status(409).json({ 
                status: 'already_used', 
                message: `Este bilhete já foi utilizado em ${new Date(ticketData.checkedInAt).toLocaleString('pt-BR')}.`,
                participantName: ticketData.participantName
            });
        }

        // Se o bilhete é válido e não foi utilizado, fazemos o check-in
        await ticketRef.update({
            isCheckedIn: true,
            checkedInAt: new Date().toISOString()
        });

        return response.status(200).json({
            status: 'success',
            message: 'Entrada validada com sucesso!',
            participantName: ticketData.participantName,
            ticketType: ticketData.ticketType
        });

    } catch (error) {
        console.error("Erro ao validar bilhete:", error);
        return response.status(500).json({ 
            status: 'error',
            message: 'Ocorreu um erro no servidor ao validar o bilhete.' 
        });
    }
}
