import { MercadoPagoConfig, Payment } from 'mercadopago';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// --- Configuração Robusta do Firebase Admin ---
let db;
let firebaseInitializationError = null;

try {
    const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!serviceAccountString) {
        throw new Error("A chave da conta de serviço do Firebase não está configurada nas variáveis de ambiente.");
    }
    const serviceAccount = JSON.parse(serviceAccountString);

    if (!getApps().length) {
      initializeApp({
        credential: cert(serviceAccount)
      });
    }
    db = getFirestore();
} catch (e) {
    console.error("Erro na Inicialização do Firebase Admin (Webhook):", e);
    firebaseInitializationError = e.message;
}
// -----------------------------------------

export default async function handler(request, response) {
    // Verifica se o Firebase foi inicializado corretamente
    if (firebaseInitializationError) {
        // Mesmo com erro, respondemos 200 para o MP não continuar a enviar
        console.error("Webhook não pode ser processado devido a erro de inicialização do Firebase.");
        return response.status(200).send('Erro interno do servidor ao processar webhook.');
    }

    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Método não permitido' });
    }

    const accessToken = process.env.MP_ACCESS_TOKEN;
    if (!accessToken) {
        console.error("Webhook não pode ser processado: Chave do MP em falta.");
        return response.status(200).send('Erro de configuração do servidor.');
    }

    const client = new MercadoPagoConfig({ accessToken });
    const payment = new Payment(client);

    const { type, data } = request.body;

    if (type === 'payment') {
        try {
            const paymentInfo = await payment.get({ id: data.id });
            
            if (paymentInfo && paymentInfo.external_reference) {
                const inscriptionId = paymentInfo.external_reference;
                const paymentStatus = paymentInfo.status;

                if (paymentStatus === 'approved') {
                    const inscriptionRef = db.collection('inscriptions').doc(inscriptionId);
                    await inscriptionRef.update({
                        paymentStatus: 'paid',
                        mercadoPagoId: data.id,
                        updatedAt: new Date().toISOString()
                    });
                    console.log(`Inscrição ${inscriptionId} atualizada para paga.`);
                }
            }
        } catch (error) {
            console.error('Erro ao processar webhook:', error);
            return response.status(200).send('Webhook processado com erro.');
        }
    }

    response.status(200).send('Webhook recebido.');
}
