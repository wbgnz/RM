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
    // Verifica primeiro os erros de inicialização
    if (firebaseInitializationError) {
        return response.status(500).json({ status: 'error', message: 'Falha na inicialização do servidor. Verifique as credenciais do Firebase.' });
    }

    if (request.method !== 'POST') {
        return response.status(405).json({ status: 'error', message: 'Método não permitido.' });
    }

    try {
        const { ticketId } = request.body;
        console.log(`[VALIDADOR] Pedido recebido para o ticketId: ${ticketId}`);

        if (!ticketId || typeof ticketId !== 'string') {
            console.error("[VALIDADOR] Erro: ticketId em falta ou inválido.");
            return response.status(400).json({ status: 'error', message: 'O ID do bilhete é inválido ou não foi fornecido.' });
        }

        const ids = ticketId.split('_');
        if (ids.length !== 2) {
            console.error(`[VALIDADOR] Erro: Formato de ticketId inválido. Esperado 'inscriptionId_singleTicketId', mas recebeu '${ticketId}'.`);
            return response.status(400).json({ status: 'error', message: 'Formato do QR Code inválido.' });
        }
        
        const [inscriptionId, singleTicketId] = ids;
        console.log(`[VALIDADOR] ID da inscrição analisado: ${inscriptionId}, ID do bilhete único: ${singleTicketId}`);

        const ticketRef = db.collection('inscriptions').doc(inscriptionId).collection('tickets').doc(singleTicketId);
        const ticketDoc = await ticketRef.get();

        if (!ticketDoc.exists) {
            console.warn(`[VALIDADOR] Aviso: Bilhete não encontrado para a inscriçãoId: ${inscriptionId}, singleTicketId: ${singleTicketId}`);
            return response.status(404).json({ 
                status: 'invalid', 
                message: 'Bilhete não encontrado. Verifique se o QR Code é do evento correto.' 
            });
        }

        const ticketData = ticketDoc.data();

        if (ticketData.isCheckedIn) {
            console.log(`[VALIDADOR] Info: Bilhete já utilizado. InscriptionId: ${inscriptionId}, check-in em ${ticketData.checkedInAt}`);
            return response.status(409).json({ 
                status: 'already_used', 
                message: `BILHETE JÁ UTILIZADO em ${new Date(ticketData.checkedInAt).toLocaleString('pt-BR')}.`,
                participantName: ticketData.participantName
            });
        }

        await ticketRef.update({
            isCheckedIn: true,
            checkedInAt: new Date().toISOString()
        });
        console.log(`[VALIDADOR] Sucesso: Bilhete validado para ${ticketData.participantName}. InscriptionId: ${inscriptionId}`);

        return response.status(200).json({
            status: 'success',
            message: 'ENTRADA VÁLIDA',
            participantName: ticketData.participantName,
            ticketType: ticketData.ticketType
        });

    } catch (error) {
        console.error("[VALIDADOR] ERRO FATAL:", error);
        return response.status(500).json({ 
            status: 'error',
            message: `Erro desconhecido no servidor. Por favor, verifique os logs. Detalhes: ${error.message}` 
        });
    }
}
