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

    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Método não permitido' });
    }

    // Futuramente, adicionaríamos aqui uma verificação do token de sessão do admin
    
    const { id } = request.body;

    if (!id) {
        return response.status(400).json({ error: 'ID da inscrição é obrigatório' });
    }

    try {
        const inscriptionRef = db.collection('inscriptions').doc(id);
        await inscriptionRef.delete();

        return response.status(200).json({ success: true, message: 'Inscrição apagada com sucesso.' });

    } catch (error) {
        console.error("Erro ao apagar inscrição:", error);
        return response.status(500).json({ error: 'Falha ao apagar a inscrição' });
    }
}
