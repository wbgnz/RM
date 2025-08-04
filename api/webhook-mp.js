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
                const payerEmail = paymentInfo.payer?.email;

                if (paymentStatus === 'approved') {
                    const inscriptionsRef = db.collection('inscriptions');
                    const approvedDocRef = inscriptionsRef.doc(inscriptionId);

                    // NOVO: Gera o QR Code como uma Data URL
                    const qrCodeDataURL = await QRCode.toDataURL(inscriptionId, { width: 300 });

                    await approvedDocRef.update({
                        paymentStatus: 'paid',
                        mercadoPagoId: data.id,
                        paymentMethod: paymentMethod,
                        qrCodeDataURL: qrCodeDataURL, // Salva o QR Code no registo
                        updatedAt: new Date().toISOString()
                    });
                    console.log(`Inscrição ${inscriptionId} atualizada para paga com QR Code.`);

                    if (payerEmail) {
                        const querySnapshot = await inscriptionsRef
                            .where('mainParticipant.email', '==', payerEmail)
                            .where('paymentStatus', '==', 'pending')
                            .get();
                        
                        if (!querySnapshot.empty) {
                            const batch = db.batch();
                            querySnapshot.forEach(doc => {
                                if (doc.id !== inscriptionId) {
                                    batch.delete(doc.ref);
                                }
                            });
                            await batch.commit();
                        }
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
