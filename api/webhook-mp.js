import { MercadoPagoConfig, Payment } from 'mercadopago';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import QRCode from 'qrcode';
import { Resend } from 'resend';

// --- Configuração Robusta do Firebase Admin ---
let db;
let firebaseInitializationError = null;
try {
    const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!serviceAccountString) throw new Error("A chave da conta de serviço do Firebase não está configurada.");
    const serviceAccount = JSON.parse(serviceAccountString);
    if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });
    db = getFirestore();
} catch (e) {
    console.error("Erro na Inicialização do Firebase Admin (Webhook):", e);
    firebaseInitializationError = e.message;
}
// -----------------------------------------

// --- Configuração do Resend ---
let resend;
let resendInitializationError = null;
try {
    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) throw new Error("A chave da API do Resend não está configurada.");
    resend = new Resend(resendApiKey);
} catch (e) {
    console.error("Erro na Inicialização do Resend:", e);
    resendInitializationError = e.message;
}
// -----------------------------------------

export default async function handler(request, response) {
    if (firebaseInitializationError || resendInitializationError) {
        console.error("Webhook não pode ser processado devido a erro de inicialização.");
        return response.status(200).send('Erro interno do servidor ao processar webhook.');
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
                    const inscriptionRef = db.collection('inscriptions').doc(inscriptionId);
                    const inscriptionDoc = await inscriptionRef.get();
                    const inscriptionData = inscriptionDoc.data();

                    // Evita processar o mesmo pagamento duas vezes
                    if (inscriptionData.paymentStatus === 'paid') {
                        return response.status(200).send('Webhook já processado.');
                    }

                    const qrCodeDataURL = await QRCode.toDataURL(inscriptionId, { width: 300 });

                    await inscriptionRef.update({
                        paymentStatus: 'paid',
                        mercadoPagoId: data.id,
                        paymentMethod: paymentMethod,
                        qrCodeDataURL: qrCodeDataURL,
                        updatedAt: new Date().toISOString()
                    });

                    // Envia o e-mail de confirmação
                    if (payerEmail) {
                        await resend.emails.send({
                            from: 'confirmacao@seu-dominio.com', // IMPORTANTE: Usar um e-mail de um domínio verificado no Resend
                            to: payerEmail,
                            subject: 'Sua inscrição para o Resenha Music está confirmada!',
                            html: `
                                <h1>Olá, ${inscriptionData.mainParticipant.name}!</h1>
                                <p>A sua inscrição para o evento <strong>Resenha Music</strong> foi confirmada com sucesso.</p>
                                <p>Para aceder ao seu bilhete digital, clique no link abaixo:</p>
                                <a href="https://${request.headers.host}/ticket.html?id=${inscriptionId}">Ver o seu Bilhete</a>
                                <p>Obrigado!</p>
                            `
                        });
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
