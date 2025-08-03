<<<<<<< HEAD
import { MercadoPagoConfig, Preference } from 'mercadopago';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// --- Configuração do Firebase Admin ---
// Pegamos as credenciais do ambiente da Vercel
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

// Inicializamos o Firebase apenas uma vez
if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount)
  });
}
const db = getFirestore();
// -----------------------------------------

const TICKET_PRICES = {
    pista: 100,
    vip: 150,
};

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method not allowed' });
    }

    const accessToken = process.env.MP_ACCESS_TOKEN;
    if (!accessToken) {
        return response.status(500).json({ error: 'Mercado Pago access token not configured' });
    }

    const client = new MercadoPagoConfig({ accessToken });
    const preference = new Preference(client);

    try {
        const { mainParticipant, additionalParticipants, ticket_type, quantity } = request.body;
        if (!mainParticipant || !ticket_type || !quantity) {
            return response.status(400).json({ error: 'Missing required data' });
        }

        const unit_price = TICKET_PRICES[ticket_type];
        if (!unit_price) {
            return response.status(400).json({ error: 'Invalid ticket type' });
        }

        // 1. Salva a inscrição no Firestore com status "pendente"
        const inscriptionRef = await db.collection('inscriptions').add({
            mainParticipant,
            additionalParticipants,
            ticket_type,
            quantity,
            unit_price,
            total_price: unit_price * quantity,
            paymentStatus: 'pending',
            createdAt: new Date().toISOString(),
        });

        const inscriptionId = inscriptionRef.id;

        // 2. Cria a preferência de pagamento no Mercado Pago
        const result = await preference.create({
            body: {
                items: [
                    {
                        title: `Ingresso ${ticket_type.toUpperCase()} - Resenha Music`,
                        description: `Inscrição para o evento Resenha Music`,
                        quantity: Number(quantity),
                        unit_price: unit_price,
                        currency_id: 'BRL',
                    },
                ],
                payer: {
                    name: mainParticipant.name,
                    email: mainParticipant.email,
                    identification: {
                        type: 'CPF',
                        number: mainParticipant.cpf.replace(/\D/g, ''),
                    },
                },
                // Passamos o ID da inscrição para o Mercado Pago
                external_reference: inscriptionId,
                // O Mercado Pago nos notificará neste endpoint
                notification_url: `https://${request.headers.host}/api/webhook-mp`,
                back_urls: {
                    success: `https://${request.headers.host}/sucesso.html`,
                    failure: `https://${request.headers.host}/falha.html`,
                    pending: `https://${request.headers.host}/pendente.html`,
                },
                auto_return: 'approved',
            }
        });
        
        return response.status(200).json({
            id: result.id,
            init_point: result.init_point,
        });

    } catch (error) {
        console.error("Detailed error creating preference:", JSON.stringify(error, null, 2));
        return response.status(500).json({ 
            error: 'Failed to create preference with Mercado Pago.',
            details: error.cause ? error.cause : error.message 
        });
    }
}
=======
// Importa o SDK do Mercado Pago
import { MercadoPagoConfig, Preference } from 'mercadopago';

// Preços dos ingressos (para garantir que o valor não seja manipulado no frontend)
const TICKET_PRICES = {
    pista: 100,
    vip: 150,
};

// O handler da Vercel espera uma função exportada como default
export default async function handler(request, response) {
    // 1. Garante que o método da requisição seja POST
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method not allowed' });
    }

    // 2. Pega a sua chave secreta do Mercado Pago das Variáveis de Ambiente
    const accessToken = process.env.MP_ACCESS_TOKEN;
    if (!accessToken) {
        console.error("MP_ACCESS_TOKEN is not defined.");
        return response.status(500).json({ error: 'Mercado Pago access token not configured' });
    }

    // 3. Configura o cliente do Mercado Pago com a sua chave
    const client = new MercadoPagoConfig({ accessToken });
    const preference = new Preference(client);

    try {
        // 4. Extrai e valida os dados do corpo da requisição
        const { mainParticipant, ticket_type, quantity } = request.body;
        if (!mainParticipant || !ticket_type || !quantity) {
            return response.status(400).json({ error: 'Missing required data' });
        }

        const unit_price = TICKET_PRICES[ticket_type];
        if (!unit_price) {
            return response.status(400).json({ error: 'Invalid ticket type' });
        }
        
        // 5. Cria a preferência de pagamento com os dados recebidos
        const result = await preference.create({
            body: {
                items: [
                    {
                        title: `Ingresso ${ticket_type.toUpperCase()} - Resenha Music`,
                        description: `Inscrição para o evento Resenha Music`,
                        quantity: Number(quantity),
                        unit_price: unit_price,
                        currency_id: 'BRL',
                    },
                ],
                // 6. Adiciona os dados do comprador para identificação
                payer: {
                    name: mainParticipant.name,
                    email: mainParticipant.email,
                    identification: {
                        type: 'CPF',
                        number: mainParticipant.cpf.replace(/\D/g, ''), // Remove a máscara do CPF
                    },
                },
                // 7. Define as URLs de retorno após o pagamento
                back_urls: {
                    success: `https://${request.headers.host}/sucesso.html`,
                    failure: `https://${request.headers.host}/falha.html`,
                    pending: `https://${request.headers.host}/pendente.html`,
                },
                auto_return: 'approved',
                external_reference: `RESENHA_MUSIC_${Date.now()}`,
            }
        });
        
        // 8. Retorna o link de pagamento para o frontend
        return response.status(200).json({
            id: result.id,
            init_point: result.init_point,
        });

    } catch (error) {
        // Log aprimorado para depuração no painel da Vercel
        console.error("Detailed error creating preference:", JSON.stringify(error, null, 2));

        // Envia uma resposta de erro mais específica para o frontend
        return response.status(500).json({ 
            error: 'Failed to create preference with Mercado Pago.',
            // A propriedade 'cause' geralmente contém a resposta detalhada da API do Mercado Pago
            details: error.cause ? error.cause : error.message 
        });
    }
}
>>>>>>> 98268b69e8004745affa1341646c76f3f3e2f837
