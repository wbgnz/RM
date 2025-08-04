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

export default async function handler(request, response) {
    if (firebaseInitializationError) {
        return response.status(500).json({ error: 'Falha na inicialização do servidor', details: firebaseInitializationError });
    }

    if (request.method !== 'GET') {
        return response.status(405).json({ error: 'Método não permitido' });
    }

    const { id } = request.query;

    if (!id) {
        return response.status(400).json({ error: 'ID da inscrição é obrigatório' });
    }

    try {
        const ticketsRef = db.collection('inscriptions').doc(id).collection('tickets');
        const snapshot = await ticketsRef.get();

        if (snapshot.empty) {
            return response.status(404).json({ error: 'Nenhum bilhete encontrado para esta inscrição' });
        }

        const tickets = [];
        snapshot.forEach(doc => {
            tickets.push({
                id: doc.id,
                ...doc.data()
            });
        });

        return response.status(200).json(tickets);

    } catch (error) {
        console.error("Erro ao obter os bilhetes:", error);
        return response.status(500).json({ error: 'Falha ao obter os dados dos bilhetes' });
    }
}
