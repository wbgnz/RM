// Este é um backend simples para autenticação.
// Numa aplicação maior, usaríamos um sistema mais robusto como JWT.

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Método não permitido' });
    }

    // 1. Obtém a senha do ambiente da Vercel para segurança
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

    if (!ADMIN_PASSWORD) {
        return response.status(500).json({ error: 'A senha do administrador não está configurada no servidor.' });
    }

    const { password } = request.body;

    // 2. Verifica se a senha enviada corresponde à senha do ambiente
    if (password === ADMIN_PASSWORD) {
        // 3. Se a senha estiver correta, envia uma resposta de sucesso com um "token" simples
        return response.status(200).json({ 
            success: true,
            // Este token é apenas uma confirmação, não um token de segurança complexo
            token: `auth-token-${new Date().getTime()}` 
        });
    } else {
        // 4. Se a senha estiver incorreta, envia uma resposta de erro
        return response.status(401).json({ error: 'Senha incorreta' });
    }
}
