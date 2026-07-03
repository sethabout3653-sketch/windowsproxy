const express = require('express');
const { Curl } = require('node-libcurl');
const { StringStream } = require('scramjet');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Serve the frontend file from the root directory
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// URL rewriting function to keep links routing through the proxy
function rewriteUrls(html, targetUrl) {
    try {
        const urlObj = new URL(targetUrl);
        const baseUrl = urlObj.origin + urlObj.pathname;

        return html.replace(/(href|src)=["'](.*?)["']/g, (match, attr, val) => {
            if (val.startsWith('http://') || val.startsWith('https://') || val.startsWith('data:')) {
                return `${attr}="/proxy?url=${encodeURIComponent(val)}"`;
            }
            if (val.startsWith('/')) {
                return `${attr}="/proxy?url=${encodeURIComponent(urlObj.origin + val)}"`;
            }
            if (val.startsWith('#') || val.startsWith('javascript:')) {
                return match;
            }
            return `${attr}="/proxy?url=${encodeURIComponent(baseUrl + '/' + val)}"`;
        });
    } catch (e) {
        return html;
    }
}

app.get('/proxy', (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).send('Missing URL parameter.');
    }

    const curl = new Curl();
    curl.setOpt('URL', targetUrl);
    curl.setOpt('FOLLOWLOCATION', true);
    curl.setOpt('SSL_VERIFYPEER', false);
    curl.setOpt('USERAGENT', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    let dataBuffer = Buffer.alloc(0);

    curl.setOpt('WRITEFUNCTION', (chunk, size, nmemb) => {
        dataBuffer = Buffer.concat([dataBuffer, chunk]);
        return size * nmemb;
    });

    curl.on('end', function (statusCode, data, headers) {
        const contentType = headers[0] ? headers[0]['Content-Type'] : 'text/html';
        res.setHeader('Content-Type', contentType || 'text/html');

        // Streaming modifications using scramjet
        StringStream.fromString(dataBuffer.toString('utf8'))
            .map(htmlChunk => {
                if (contentType && contentType.includes('text/html')) {
                    return rewriteUrls(htmlChunk, targetUrl);
                }
                return htmlChunk;
            })
            .pipe(res);

        curl.close();
    });

    curl.on('error', function (err) {
        res.status(500).send(`Proxy Error: ${err.message}`);
        curl.close();
    });

    curl.perform();
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
