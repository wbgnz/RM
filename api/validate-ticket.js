import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldPath } from 'firebase-admin/firestore';

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

    // --- ROTA GET: Devolve a lista de todos os que já fizeram check-in ---
    if (request.method === 'GET') {
        try {
            const ticketsQuery = db.collectionGroup('tickets').where('isCheckedIn', '==', true);
            const querySnapshot = await ticketsQuery.get();

            if (querySnapshot.empty) {
                return response.status(200).json([]);
            }

            let checkedInList = [];
            querySnapshot.forEach(doc => {
                const data = doc.data();
                // Adiciona apenas se tiver os dados necessários para ordenar e exibir
                if (data.participantName && data.ticketType && data.checkedInAt) {
                    checkedInList.push({
                        name: data.participantName,
                        type: data.ticketType,
                        checkedInAt: data.checkedInAt
                    });
                }
            });

            // Ordena pela data, do mais recente para o mais antigo
            checkedInList.sort((a, b) => new Date(b.checkedInAt) - new Date(a.checkedInAt));
            
            // Formata a data para a exibição final *depois* de ordenar
            const formattedList = checkedInList.map(item => ({
                name: item.name,
                type: item.type,
                time: new Date(item.checkedInAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
            }));

            return response.status(200).json(formattedList);

        } catch (error) {
            console.error("Erro ao buscar a lista de entradas:", error);
            return response.status(500).json({ error: 'Falha ao buscar a lista de entradas.' });
        }
    }

    // --- ROTA POST: Valida um bilhete individual ---
    if (request.method === 'POST') {
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
                    return response.status(409).json({ status: 'already_used', message: `BILHETE JÁ UTILIZADO em ${new Date(ticketData.checkedInAt).toLocaleString('pt-BR')}.`, participantName: ticketData.participantName, ticketType: ticketData.ticketType });
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
                         return response.status(403).json({ status: 'not_paid', message: 'Este bilhete não está pago.', participantName: inscriptionData.mainParticipant.name, ticketType: inscriptionData.ticket_type });
                    }
                    if (inscriptionData.isCheckedIn) {
                        return response.status(409).json({ status: 'already_used', message: `BILHETE JÁ UTILIZADO em ${new Date(inscriptionData.checkedInAt).toLocaleString('pt-BR')}.`, participantName: inscriptionData.mainParticipant.name, ticketType: inscriptionData.ticket_type });
                    }
                    await inscriptionRef.update({ isCheckedIn: true, checkedInAt: new Date().toISOString() });
                    return response.status(200).json({ status: 'success', message: 'ENTRADA VÁLIDA', participantName: inscriptionData.mainParticipant.name, ticketType: inscriptionData.ticket_type });
                }

                // Lógica de fallback final: Pesquisa exaustiva
                const inscriptionsSnapshot = await db.collection('inscriptions').get();
                for (const inscDoc of inscriptionsSnapshot.docs) {
                    const ticketRef = inscDoc.ref.collection('tickets').doc(ticketId);
                    const ticketDoc = await ticketRef.get();
                    
                    if (ticketDoc.exists) {
                        const ticketData = ticketDoc.data();
                        const inscriptionData = inscDoc.data();

                        if (inscriptionData.paymentStatus !== 'paid') {
                            return response.status(403).json({ status: 'not_paid', message: 'A compra deste bilhete não foi paga.', participantName: ticketData.participantName, ticketType: ticketData.ticketType });
                        }
                        if (ticketData.isCheckedIn) {
                            return response.status(409).json({ status: 'already_used', message: `BILHETE JÁ UTILIZADO em ${new Date(ticketData.checkedInAt).toLocaleString('pt-BR')}.`, participantName: ticketData.participantName, ticketType: ticketData.ticketType });
                        }

                        await ticketRef.update({ isCheckedIn: true, checkedInAt: new Date().toISOString() });
                        return response.status(200).json({ status: 'success', message: 'ENTRADA VÁLIDA', participantName: ticketData.participantName, ticketType: ticketData.ticketType });
                    }
                }
                
                return response.status(404).json({ status: 'invalid', message: `Bilhete não encontrado para o ID: ${ticketId}` });
            }

        } catch (error) {
            console.error("[VALIDADOR] ERRO FATAL:", error);
            return response.status(500).json({ status: 'error', message: `Erro desconhecido no servidor. Detalhes: ${error.message}` });
        }
    }

    return response.status(405).json({ status: 'error', message: 'Método não permitido.' });
}

