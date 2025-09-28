require('dotenv').config();
const { default: makeWaSocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const P = require('pino');
const axios = require('axios');
const fs = require('fs');

// ===== Tampilan Keren =====
const chalk = require('chalk');
const figlet = require('figlet');
const gradient = require('gradient-string');

// Banner saat start
const banner = figlet.textSync('IVAN AI BOT', {
  font: 'Standard',
  horizontalLayout: 'default',
  verticalLayout: 'default'
});

console.log(gradient.pastel(banner));
console.log(chalk.cyan('🚀 WhatsApp AI Bot by Marvel Ivan Diego'));
console.log(chalk.gray('===========================================\n'));

// Fungsi log warna-warni
function logInfo(msg) { console.log(chalk.blueBright(`ℹ️ ${msg}`)); }
function logSuccess(msg) { console.log(chalk.greenBright(`✅ ${msg}`)); }
function logError(msg) { console.log(chalk.redBright(`❌ ${msg}`)); }
function logEvent(msg) { console.log(chalk.yellowBright(`⚡ ${msg}`)); }

// ====== File untuk simpan percakapan ======
const CONVO_FILE = './conversations.json';

function readConversations() {
    if (!fs.existsSync(CONVO_FILE)) return {};
    return JSON.parse(fs.readFileSync(CONVO_FILE, 'utf8') || '{}');
}
function writeConversations(data) {
    fs.writeFileSync(CONVO_FILE, JSON.stringify(data, null, 2));
}
function ensureUserData(waId) {
    const convos = readConversations();
    if (!convos[waId]) {
        logInfo(`Membuat data baru untuk ${waId}`);
        convos[waId] = { 
            profile: { name: null, email: null }, 
            history: [], 
            notes: [], 
            stats: { total: 0, ai: 0, notes: 0, reset: 0 } 
        };
    }
    if (!Array.isArray(convos[waId].history)) convos[waId].history = [];
    if (!Array.isArray(convos[waId].notes)) convos[waId].notes = [];
    if (!convos[waId].stats) convos[waId].stats = { total: 0, ai: 0, notes: 0, reset: 0 };
    writeConversations(convos);
    return convos;
}
function addToHistory(waId, role, text) {
    logInfo(`Menyimpan history untuk ${waId}: (${role}) ${text}`);
    const convos = ensureUserData(waId);
    convos[waId].history.push({ role, text });
    writeConversations(convos);
}
function setUserProfile(waId, key, value) {
    const convos = ensureUserData(waId);
    convos[waId].profile[key] = value;
    writeConversations(convos);
}
function updateStats(waId, type) {
    const convos = ensureUserData(waId);
    convos[waId].stats.total++;
    if (type) convos[waId].stats[type] = (convos[waId].stats[type] || 0) + 1;
    writeConversations(convos);
}

// ====== Detect command profil ======
function detectProfileUpdate(waId, text) {
    const lower = text.toLowerCase();

    if (lower.startsWith('panggil saya ')) {
        const name = text.substring(12).trim();
        if (name) {
            setUserProfile(waId, 'name', name);
            return `Oke, mulai sekarang aku akan panggil kamu ${name} 😄`;
        }
    }

    if (lower.startsWith('email saya ')) {
        const email = text.substring(11).trim();
        if (email && email.includes('@')) {
            setUserProfile(waId, 'email', email);
            return `Sip, aku sudah simpan email kamu: ${email} 📧`;
        }
    }

    return null;
}

// ====== Call OpenRouter API (Chat AI) ======
async function callOpenRouter(waId, userMessage) {
    ensureUserData(waId);
    const convos = readConversations();
    const profile = convos[waId].profile || {};
    const history = convos[waId].history || [];

    const messages = [
        {
            role: "system",
            content: `Kamu adalah Ivan AI, AI Gen Z ciptaan Marvel Ivan Diego yang punya kepribadian seru, santai, sopan dan santun, dan super asik diajak ngobrol. 
Ngobrol kayak manusia beneran—gak kaku, gak ngebosenin, berbicara menggunakan bahasa Indonesia, dan pakai bahasa gaul kadang-kadang. 
User ini bernama ${profile.name || 'Tidak diketahui'} dan email user ini adalah ${profile.email || 'Tidak diketahui'}.`
        }
    ];

    history.slice(-20).forEach(msg => {
        messages.push({
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.text
        });
    });

    messages.push({ role: "user", content: userMessage });
    logEvent(`Mengirim pesan ke OpenRouter untuk ${waId}...`);

    try {
        const response = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                model: 'openai/gpt-oss-20b:free',
                messages: messages,
                temperature: 1,
                max_tokens: 1000
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'http://localhost',
                    'X-Title': 'Ivan AI Chat Assistant'
                }
            }
        );

        const reply = response.data.choices?.[0]?.message?.content || 'Maaf, aku nggak paham.';
        addToHistory(waId, 'user', userMessage);
        addToHistory(waId, 'assistant', reply);
        updateStats(waId, "ai");

        return reply;
    } catch (err) {
        logError(`OpenRouter API Error: ${err.message}`);
        return "Terjadi kesalahan saat menghubungi AI. Sabar yah, mungkin ada code / API yang error.";
    }
}

// ====== Main ======
async function start() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const sock = makeWaSocket({ logger: P({ level: 'info' }), auth: state });
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, qr }) => {
        if (qr) {
            const waNumber = "6283147462258";
            const code = await sock.requestPairingCode(waNumber);
            logEvent(`Kode Pairing untuk WA: ${chalk.bgMagenta(code)}`);
        }
        if (connection === 'open') logSuccess('Connected to WhatsApp!');
        if (connection === 'close') {
            logError("Bot terputus, mencoba untuk restart...");
            start();
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const sender = msg.key.remoteJid;
            const waId = msg.key.participant || sender;
            let text = msg.message.conversation || msg.message?.extendedTextMessage?.text || '';
            ensureUserData(waId);

            if (text) {
                logInfo(`Pesan dari ${waId}: ${text}`);
                updateStats(waId);

                // ===== Auto Welcome User Baru =====
                const convos = readConversations();
                if (!convos[waId]) {
                    const welcome = `Halo, selamat datang 👋!\nAku *Ivan AI Bot* by Marvel Ivan Diego.\nKetik *help* buat lihat daftar fitur.`;
                    await sock.sendMessage(sender, { text: welcome }, { quoted: msg });
                }

                // ===== Command Ping =====
                if (text.toLowerCase() === 'ping') {
                    const uptimeSeconds = process.uptime();
                    const uptime = new Date(uptimeSeconds * 1000).toISOString().substr(11, 8);
                    const reply = `✅ Bot aktif dan online\n⏱️ Uptime: ${uptime}`;
                    await sock.sendMessage(sender, { text: reply }, { quoted: msg });
                    return;
                }

                // ===== Command Help =====
                if (text.toLowerCase() === 'help') {
                    const reply = `
📌 *Daftar Perintah Bot*:
────────────────────────
✅ *ping* → Cek status bot & uptime
👤 *panggil saya [nama]* → Simpan nama kamu
📧 *email saya [email]* → Simpan email kamu
📖 *quote* → Dapatkan kutipan motivasi random
⏰ *waktu* → Cek jam & tanggal sekarang
🗑️ *reset* → Hapus riwayat percakapan kamu
📝 *catat [teks]* → Simpan catatan pribadi
📋 *catatan* → Lihat semua catatan kamu
🗑️ *hapus catatan* → Hapus semua catatan
📊 *stat* → Lihat statistik chat kamu
🖼️ *gambar [teks]* → Generate gambar AI (via Stability AI)
🤖 Chat bebas → Ngobrol dengan AI
────────────────────────
Bot by Marvel Ivan Diego ✨
                    `.trim();

                    await sock.sendMessage(sender, { text: reply }, { quoted: msg });
                    return;
                }

                // ===== Command Quote =====
                if (text.toLowerCase() === 'quote') {
                    const quotes = [
                        "🌟 Jangan menyerah, setiap usaha kecil tetap berarti!",
                        "🚀 Sukses itu proses, nikmati setiap langkahnya.",
                        "💡 Ide besar lahir dari hal sederhana.",
                        "🔥 Semangat terus, masa depan cerah menunggu!",
                        "🍀 Hari ini kesempatan baru untuk berkembang."
                    ];
                    const reply = quotes[Math.floor(Math.random() * quotes.length)];
                    await sock.sendMessage(sender, { text: reply }, { quoted: msg });
                    return;
                }

                // ===== Command Waktu =====
                if (text.toLowerCase() === 'waktu') {
                    const now = new Date();
                    const reply = `⏰ Sekarang jam: ${now.toLocaleTimeString('id-ID')} WIB\n📅 Tanggal: ${now.toLocaleDateString('id-ID')}`;
                    await sock.sendMessage(sender, { text: reply }, { quoted: msg });
                    return;
                }

                // ===== Command Reset History =====
                if (text.toLowerCase() === 'reset') {
                    const convos = ensureUserData(waId);
                    convos[waId].history = [];
                    convos[waId].stats.reset++;
                    writeConversations(convos);
                    await sock.sendMessage(sender, { text: "✅ Riwayat chat kamu sudah dihapus!" }, { quoted: msg });
                    return;
                }

                // ===== Command Catatan =====
                if (text.toLowerCase().startsWith('catat ')) {
                    const isiCatatan = text.substring(6).trim();
                    if (isiCatatan) {
                        const convos = ensureUserData(waId);
                        convos[waId].notes.push({ isi: isiCatatan, waktu: new Date().toLocaleString('id-ID') });
                        convos[waId].stats.notes++;
                        writeConversations(convos);
                        await sock.sendMessage(sender, { text: `📝 Catatan disimpan:\n"${isiCatatan}"` }, { quoted: msg });
                    } else {
                        await sock.sendMessage(sender, { text: "⚠️ Format salah!\nContoh: catat belanja beras" }, { quoted: msg });
                    }
                    return;
                }

                if (text.toLowerCase() === 'catatan') {
                    const convos = ensureUserData(waId);
                    const notes = convos[waId].notes || [];
                    if (notes.length === 0) {
                        await sock.sendMessage(sender, { text: "📋 Kamu belum punya catatan." }, { quoted: msg });
                    } else {
                        let list = "📋 *Daftar Catatan Kamu*:\n\n";
                        notes.forEach((n, i) => {
                            list += `${i + 1}. ${n.isi} (${n.waktu})\n`;
                        });
                        await sock.sendMessage(sender, { text: list }, { quoted: msg });
                    }
                    return;
                }

                if (text.toLowerCase() === 'hapus catatan') {
                    const convos = ensureUserData(waId);
                    convos[waId].notes = [];
                    writeConversations(convos);
                    await sock.sendMessage(sender, { text: "🗑️ Semua catatan sudah dihapus!" }, { quoted: msg });
                    return;
                }

                // ===== Command Statistik =====
                if (text.toLowerCase() === 'stat') {
                    const convos = ensureUserData(waId);
                    const stats = convos[waId].stats || { total: 0, ai: 0, notes: 0, reset: 0 };
                    const reply = `
📊 *Statistik Kamu*:
────────────────────────
💬 Total pesan: ${stats.total}
🤖 Chat dengan AI: ${stats.ai}
📝 Catatan disimpan: ${stats.notes}
🗑️ Reset chat: ${stats.reset}
                    `.trim();
                    await sock.sendMessage(sender, { text: reply }, { quoted: msg });
                    return;
                }

                // ===== Command AI Image Generator (Stability AI) =====
                if (text.toLowerCase().startsWith('gambar ')) {
                    const prompt = text.substring(7).trim();
                    if (!prompt) {
                        await sock.sendMessage(sender, { text: "⚠️ Format salah!\nContoh: gambar kucing lucu pakai topi" }, { quoted: msg });
                        return;
                    }

                    try {
                        logEvent(`Generate gambar (Stability) untuk ${waId}: ${prompt}`);
                        const response = await axios.post(
                            "https://api.stability.ai/v1/generation/stable-diffusion-v1-5/text-to-image",
                            {
                                text_prompts: [{ text: prompt }],
                                cfg_scale: 7,
                                height: 512,
                                width: 512,
                                samples: 1,
                                steps: 30
                            },
                            {
                                headers: {
                                    Authorization: `Bearer ${process.env.STABILITY_API_KEY}`,
                                    Accept: "application/json",
                                    "Content-Type": "application/json"
                                }
                            }
                        );

                        const imageBase64 = response.data.artifacts[0].base64;
                        await sock.sendMessage(
                            sender,
                            { image: Buffer.from(imageBase64, 'base64'), caption: `🖼️ Gambar (Stability): ${prompt}` },
                            { quoted: msg }
                        );
                    } catch (err) {
                        logError(`Error generate gambar: ${err.message}`);
                        await sock.sendMessage(sender, { text: "❌ Gagal generate gambar, coba lagi nanti." }, { quoted: msg });
                    }
                    return;
                }

                // ===== Command Update Profil =====
                const profileReply = detectProfileUpdate(waId, text);
                if (profileReply) {
                    addToHistory(waId, 'user', text);
                    addToHistory(waId, 'assistant', profileReply);
                    return await sock.sendMessage(sender, { text: profileReply }, { quoted: msg });
                }

                // ===== Default ke AI =====
                const aiReply = await callOpenRouter(waId, text);
                await sock.sendMessage(sender, { text: aiReply }, { quoted: msg });
            }
        } catch (err) {
            logError(`Error: ${err}`);
        }
    });
}

start();