import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import QRCode from 'qrcode';

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

    try {
        let processedCount = 0;
        const inscriptionsRef = db.collection('inscriptions');
        
        // CORRIGIDO: Procura por inscrições pagas que NÃO TÊM o marcador qrCodeGenerated
        const snapshot = await inscriptionsRef
            .where('paymentStatus', '==', 'paid')
            .get();

        if (snapshot.empty) {
            return response.status(200).json({ success: true, message: 'Nenhuma inscrição a necessitar de QR Code.', count: 0 });
        }

        for (const doc of snapshot.docs) {
            // Verifica se o marcador já existe
            if (doc.data().qrCodeGenerated) {
                continue; // Pula para a próxima se já foi processado
            }

            const inscriptionId = doc.id;
            const ticketsSnapshot = await doc.ref.collection('tickets').get();
            
            if (!ticketsSnapshot.empty) {
                const batch = db.batch();
                for (const ticketDoc of ticketsSnapshot.docs) {
                    const ticketId = ticketDoc.id;
                    const qrCodeDataURL = await QRCode.toDataURL(ticketId, { width: 300 });
                    batch.update(ticketDoc.ref, { 
                        qrCodeDataURL: qrCodeDataURL,
                        status: 'valid'
                    });
                }

                // Adiciona o marcador para evitar que seja processado novamente
                batch.update(doc.ref, { qrCodeGenerated: true });
                await batch.commit();
                processedCount++;
                console.log(`QR Codes gerados para a inscrição ${inscriptionId}.`);
            }
        }

        if (processedCount === 0) {
            return response.status(200).json({ success: true, message: 'Nenhuma inscrição a necessitar de QR Code.', count: 0 });
        }

        return response.status(200).json({ success: true, message: `QR Codes gerados para ${processedCount} inscrições.`, count: processedCount });

    } catch (error) {
        console.error("Erro ao regenerar QR Codes:", error);
        return response.status(500).json({ error: 'Falha ao regenerar os QR Codes' });
    }
}
