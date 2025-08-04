import { MercadoPagoConfig, Payment } from 'mercadopago';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import QRCode from 'qrcode';

// --- Configuração Robusta do Firebase Admin ---
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
    console.error("Erro na Inicialização do Firebase Admin (Webhook):", e);
    firebaseInitializationError = e.message;
}
// -----------------------------------------

export default async function handler(request, response) {
    if (firebaseInitializationError) {
        return response.status(200).send('Erro interno do servidor.');
    }

    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Método não permitido' });
    }

    const accessToken = process.env.MP_ACCESS_TOKEN;
    if (!accessToken) {
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
                const paymentMethod = paymentInfo.payment_method_id || 'N/A';

                if (paymentStatus === 'approved') {
                    const inscriptionRef = db.collection('inscriptions').doc(inscriptionId);
                    
                    // Atualiza o documento principal da inscrição para "paga"
                    await inscriptionRef.update({
                        paymentStatus: 'paid',
                        mercadoPagoId: data.id,
                        paymentMethod: paymentMethod,
                        updatedAt: new Date().toISOString()
                    });
                    console.log(`Inscrição principal ${inscriptionId} atualizada para paga.`);

                    // NOVO: Busca todos os bilhetes individuais e gera um QR Code para cada um
                    const ticketsSnapshot = await inscriptionRef.collection('tickets').get();
                    if (!ticketsSnapshot.empty) {
                        const batch = db.batch();
                        for (const ticketDoc of ticketsSnapshot.docs) {
                            const ticketId = ticketDoc.id;
                            const qrCodeDataURL = await QRCode.toDataURL(ticketId, { width: 300 });
                            batch.update(ticketDoc.ref, { 
                                qrCodeDataURL: qrCodeDataURL,
                                status: 'valid'
                            });
                            console.log(`QR Code gerado para o bilhete ${ticketId}.`);
                        }
                        await batch.commit();
                    }
                }
            }
        } catch (error) {
            console.error('Erro ao processar webhook:', error);
            return response.status(200).send('Webhook processado com erro.');
        }
    }

    response.status(200).send('Webhook recebido.');
}
