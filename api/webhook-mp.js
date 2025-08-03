import { MercadoPagoConfig, Payment } from 'mercadopago';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// --- Configuração do Firebase Admin ---
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount)
  });
}
const db = getFirestore();
// -----------------------------------------

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method not allowed' });
    }

    const accessToken = process.env.MP_ACCESS_TOKEN;
    if (!accessToken) {
        return response.status(500).json({ error: 'Mercado Pago access token not configured' });
    }

    const client = new MercadoPagoConfig({ accessToken });
    const payment = new Payment(client);

    const { type, data } = request.body;

    // Verificamos se é uma notificação de pagamento
    if (type === 'payment') {
        try {
            const paymentInfo = await payment.get({ id: data.id });
            
            if (paymentInfo && paymentInfo.external_reference) {
                const inscriptionId = paymentInfo.external_reference;
                const paymentStatus = paymentInfo.status; // ex: "approved", "rejected"

                // Se o pagamento foi aprovado, atualizamos o status no Firestore
                if (paymentStatus === 'approved') {
                    const inscriptionRef = db.collection('inscriptions').doc(inscriptionId);
                    await inscriptionRef.update({
                        paymentStatus: 'paid',
                        mercadoPagoId: data.id,
                        updatedAt: new Date().toISOString()
                    });
                    console.log(`Inscription ${inscriptionId} updated to paid.`);
                }
            }
        } catch (error) {
            console.error('Error processing webhook:', error);
            // Mesmo com erro, retornamos 200 para o MP não continuar enviando
            return response.status(200).send('Webhook processed with error.');
        }
    }

    // Responde ao Mercado Pago que a notificação foi recebida com sucesso
    response.status(200).send('Webhook received.');
}
