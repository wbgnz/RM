import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import QRCode from 'qrcode';
import { Resend } from 'resend';

// --- Configuração dos Serviços ---
let db, resend;
let initializationError = null;
try {
    const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!serviceAccountString) throw new Error("A chave do Firebase não está configurada.");
    const serviceAccount = JSON.parse(serviceAccountString);
    if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });
    db = getFirestore();

    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) throw new Error("A chave da API do Resend não está configurada.");
    resend = new Resend(resendApiKey);
} catch (e) {
    console.error("Erro na Inicialização:", e);
    initializationError = e.message;
}
// -----------------------------------------

export default async function handler(request, response) {
    if (initializationError) {
        return response.status(500).json({ error: 'Falha na inicialização do servidor', details: initializationError });
    }

    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Método não permitido' });
    }

    const { id } = request.body;
    if (!id) {
        return response.status(400).json({ error: 'ID da inscrição é obrigatório' });
    }

    try {
        const inscriptionRef = db.collection('inscriptions').doc(id);
        const inscriptionDoc = await inscriptionRef.get();

        if (!inscriptionDoc.exists || inscriptionDoc.data().paymentStatus !== 'awaiting_approval') {
            return response.status(404).json({ error: 'Inscrição não encontrada ou já processada.' });
        }
        
        const inscriptionData = inscriptionDoc.data();

        // Gera os QR Codes para cada bilhete individual
        const ticketsSnapshot = await inscriptionRef.collection('tickets').get();
        if (!ticketsSnapshot.empty) {
            const batch = db.batch();
            for (const ticketDoc of ticketsSnapshot.docs) {
                const qrCodeDataURL = await QRCode.toDataURL(ticketDoc.id, { width: 300 });
                batch.update(ticketDoc.ref, { 
                    qrCodeDataURL: qrCodeDataURL,
                    status: 'valid'
                });
            }
            await batch.commit();
        }

        // Atualiza o estado da inscrição principal para "paga"
        await inscriptionRef.update({
            paymentStatus: 'paid', // O estado muda para 'paid' para ser consistente com os outros
            qrCodeGenerated: true,
            updatedAt: new Date().toISOString()
        });

        // Envia o e-mail de confirmação com o link para o bilhete
        await resend.emails.send({
            from: 'confirmacao@pay.resenhamusic.com.br',
            to: inscriptionData.mainParticipant.email,
            subject: 'O seu voucher para o Resenha Music foi aprovado!',
            html: `
                <h1>Olá, ${inscriptionData.mainParticipant.name}!</h1>
                <p>A sua solicitação de inscrição com o voucher <strong>${inscriptionData.appliedCoupon}</strong> foi aprovada!</p>
                <p>Para aceder aos seus bilhetes digitais, clique no link abaixo:</p>
                <a href="https://${request.headers.host}/ticket.html?id=${id}">Ver os seus Bilhetes</a>
                <p>Obrigado!</p>
            `
        });

        return response.status(200).json({ success: true, message: 'Inscrição aprovada e e-mail enviado.' });

    } catch (error) {
        console.error("Erro ao aprovar a inscrição:", error);
        return response.status(500).json({ error: 'Falha ao aprovar a inscrição' });
    }
}
