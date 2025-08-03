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

export default async function handler(request, response) {
    if (firebaseInitializationError) {
        return response.status(500).json({ error: 'Falha na inicialização do servidor', details: firebaseInitializationError });
    }

    // Por agora, vamos manter simples. Mais tarde, adicionaremos uma verificação de senha aqui.
    if (request.method !== 'GET') {
        return response.status(405).json({ error: 'Método não permitido' });
    }

    try {
        const inscriptionsRef = db.collection('inscriptions');
        const snapshot = await inscriptionsRef.orderBy('createdAt', 'desc').get();

        if (snapshot.empty) {
            return response.status(200).json([]);
        }

        const inscriptions = [];
        snapshot.forEach(doc => {
            inscriptions.push({
                id: doc.id,
                ...doc.data()
            });
        });

        return response.status(200).json(inscriptions);

    } catch (error) {
        console.error("Erro ao obter as inscrições:", error);
        return response.status(500).json({ error: 'Falha ao obter os dados das inscrições' });
    }
}
