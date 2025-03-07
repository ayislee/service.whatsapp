const express = require('express');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');
const { setTimeout } = require('timers/promises');
const { Client, LocalAuth, ClientInfo, Buttons } = require('whatsapp-web.js');
const cors = require("cors");
const axios = require('axios');
const morgan = require('morgan');
const rfs = require('rotating-file-stream');
const moment = require('moment-timezone'); // Tambahkan ini
require('dotenv').config()
const app = express();

// Buat direktori logs jika belum ada
const logDirectory = path.join(__dirname, 'logs');
fs.existsSync(logDirectory) || fs.mkdirSync(logDirectory);

// Buat rotating write stream
const accessLogStream = rfs.createStream('access.log', {
    interval: '1d', // rotasi harian
    path: logDirectory
});

// Buat format log kustom
morgan.token('date', (req, res, tz) => {
    return moment().tz(tz).format('YYYY-MM-DD HH:mm:ss');
});

// Gunakan morgan untuk mencatat log ke file dengan format kustom
app.use(morgan(':remote-addr - :remote-user [:date[Asia/Jakarta]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"', { stream: accessLogStream }));

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

const port = process.env.PORT;
const api_services_url = process.env.API_SERVICE_URL;
const service = process.env.SERVICE;

let sessionData;
let client;
let localauth

function getFrom(source) {

}

async function initializeWA() {

    // Use the saved values
    localauth = new LocalAuth();
    client = new Client({
        authStrategy: localauth,
        restartOnAuthFail: true, // related problem solution
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setupid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable.gpu'
            ]
        }
    });
    client.initialize().catch(_ => _);

    client.on('loading_screen', (percent, message) => {
        console.log('LOADING SCREEN', percent, message);
        // Tambahkan log ke file
        fs.appendFileSync(path.join(logDirectory, 'access.log'), `[${moment().format('YYYY-MM-DD HH:mm:ss')}] LOADING SCREEN ${percent} ${message}\n`);
    });

    client.on('qr', async (qr) => {
        qrcode.generate(qr, { small: true });
        try {
            // ${api_services_url}qr?qr=${qr}&service=${service}
            const response = await axios(` ${api_services_url}qr?qr=${qr}&service=${service}`);
            // console.log(response.data);
            // Tambahkan log ke file
            fs.appendFileSync(path.join(logDirectory, 'access.log'), `[${moment().format('YYYY-MM-DD HH:mm:ss')}] QR CODE GENERATED ${qr}\n`);
        } catch (error) {
            // console.log('terjadi error', error);
            // Tambahkan log ke file
            fs.appendFileSync(path.join(logDirectory, 'access.log'), `[${moment().format('YYYY-MM-DD HH:mm:ss')}] ERROR ${error.message}\n`);
        }
    });

    client.on('ready', async () => {
        // console.log('Client is ready!');
        try {
            const response = await axios(` ${api_services_url}status?&service=${service}&status=ready`);
            // console.log(response.data);
            // Tambahkan log ke file
            fs.appendFileSync(path.join(logDirectory, 'access.log'), `[${moment().format('YYYY-MM-DD HH:mm:ss')}] CLIENT READY\n`);
        } catch (error) {
            // console.log('error', error.message);
            // Tambahkan log ke file
            fs.appendFileSync(path.join(logDirectory, 'access.log'), `[${moment().format('YYYY-MM-DD HH:mm:ss')}] ERROR ${error.message}\n`);
            // const response = await axios.post(`${api_services_url}message`);
        }
    });

    client.on("message", async (message) => {
        const direct = message.from === message.id.remote;
        const chat = message.from.search("@c.us") >= 0;

        // function 
        try {
            if (message.type === 'chat' && direct && chat) {
                const response = await axios({
                    method: 'post',
                    url: `${api_services_url}message`,
                    data: {
                        service: service,
                        id: message.id,
                        type: message.type,
                        from: message.from,
                        to: message.to,
                        body: message.body
                    }
                });
                // console.log(response.data);
                // Tambahkan log ke file
                fs.appendFileSync(path.join(logDirectory, 'access.log'), `[${moment().format('YYYY-MM-DD HH:mm:ss')}] MESSAGE RECEIVED ${message.body}\n`);
            }
        } catch (error) {
            // console.log('error', error.message);
            // Tambahkan log ke file
            fs.appendFileSync(path.join(logDirectory, 'access.log'), `[${moment().format('YYYY-MM-DD HH:mm:ss')}] ERROR ${error.message}\n`);
        }
    });

    client.on("auth_failure", () => {
        console.log('Auth Fail');
        // Tambahkan log ke file
        fs.appendFileSync(path.join(logDirectory, 'access.log'), `[${moment().format('YYYY-MM-DD HH:mm:ss')}] AUTH FAILURE\n`);
    });

    // client.on("disconnected", async (reason) => {
    //     console.log('disconnected');
    //     client.destroy();
    //     initializeWA();
    // })
}

function initializeHTTP(c) {
    app.get('/', (req, res, next) => {
        res.send('Welcome Whatsapp services');
    });

    app.post('/sendmessage', async (req, res, next) => {
        // return res.send('body : ',req.body);
        // console.log(req)
        let to = req.body.to
        let message = req.body.message
        if (to.startsWith("0")) {
            to = "62" + to.slice(1) + "@c.us";
        } else if (to.startsWith("62")) {
            to = to + "@c.us";
        } else {
            to = "62" + to + "@c.us";
        }
    
        try {
            const state = await client.getState()
    
            if (state === null) {
                return res.status(200).send({
                    status: false,
                    message: 'Need Link'
                });
    
            } else if (state === 'CONNECTED') {
                // check register user
                const checkUser = await client.isRegisteredUser(to);
                if (checkUser) {
    
                    client.sendMessage(to, message);
    
                    let button = new Buttons('Button body', [{ body: 'bt1' }, { body: 'bt2' }, { body: 'bt3' }], 'title', 'footer');
                    client.sendMessage(to, button);
    
                    return res.send({
                        status: true,
                        message: "success"
                    })
    
                } else {
                    return res.send({
                        status: false,
                        message: "User unregistered"
                    });
                }
            }
        } catch (error) {
            // console.log(error)
            return res.status(500).send({
                status: false,
                message: 'Service Disconnected'
            });
        }
    });

    app.get('/status', async (req, res, next) => {
        // console.log('get status')
        try {
            const status = await client.getState()
            return res.status(200).send({
                status: true,
                message: status
            })
        } catch (error) {
            // const status = await client.getState()
            return res.status(200).send({
                status: false,
                message: error.message
            })
        }
    })

    app.get('/connect', async (req, res, next) => {
        // Jika status serkarang sedang terkoneksi jgn lakukan ini 
        try {
            const status = await client.getState()
            if (status === 'CONNECTED') {

                return res.status(200).send({
                    status: false,
                    messaga: "Service already connected"
                })
            } else {
                initializeWA();
                return res.status(200).send({
                    status: true,
                    messaga: "Service Restarted"
                })
            }
        } catch (error) {
            initializeWA();
            return res.status(200).send({
                status: true,
                messaga: "Service Restarted"
            })
        }


    });

    app.listen(port, () => {
        fs.appendFileSync(path.join(logDirectory, 'access.log'), `[${moment().format('YYYY-MM-DD HH:mm:ss')}] [INFO] listening to port ${port}\n`);
        console.log('listening to port', port);
    });
}

initializeWA();
initializeHTTP(client);