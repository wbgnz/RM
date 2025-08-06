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

    const { couponCode } = request.body;

    if (!couponCode) {
        return response.status(400).json({ error: 'O código do cupão é obrigatório' });
    }

    try {
        const couponRef = db.collection('coupons').doc(couponCode.toUpperCase());
        const doc = await couponRef.get();

        if (!doc.exists) {
            return response.status(404).json({ error: 'Cupão inválido ou não encontrado' });
        }

        const couponData = doc.data();

        // Futuramente, podemos adicionar aqui lógicas de validade, limite de utilizações, etc.

        return response.status(200).json({ 
            success: true, 
            coupon: {
                code: doc.id,
                type: couponData.type, // 'percentage' ou 'fixed'
                value: couponData.value
            }
        });

    } catch (error) {
        console.error("Erro ao validar o cupão:", error);
        return response.status(500).json({ error: 'Falha ao validar o cupão' });
    }
}
