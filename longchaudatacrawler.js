const puppeteer = require('puppeteer-core');
const fs = require('fs/promises');
const xml2js = require('xml2js');

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// In case there are no stock :D, i have to generate a random stock
function generateRandomStock() {
    return Math.floor(Math.random() * 500) + 1;
}

async function crawlLongChauSitemap() {
    let browser;
    try {
        console.log('Starting Long Châu crawler...');

        browser = await puppeteer.launch({
            executablePath: '/snap/bin/brave',
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-gpu',
                '--disable-blink-features=AutomationControlled'
            ]
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1366, height: 768 });
        await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Manually type the xml, JS have no built-in support for taking input :D
        const sitemapUrl = 'https://nhathuoclongchau.com.vn/sitemap_trang-thiet-bi-y-te.xml';
        console.log('Fetching sitemap:', sitemapUrl);

        let response, sitemapContent;

        if (sitemapUrl.startsWith('file://')) {
            const filePath = sitemapUrl.replace('file://', '');
            sitemapContent = await fs.readFile(filePath, 'utf8');
        } else {
            response = await page.goto(sitemapUrl, {
                waitUntil: 'networkidle2',
                timeout: 60000
            });

            if (!response.ok()) {
                throw new Error(`HTTP ${response.status()}: ${response.statusText()}`);
            }
            sitemapContent = await response.text();
        }
        const parser = new xml2js.Parser();
        const sitemapData = await parser.parseStringPromise(sitemapContent);
        const urls = sitemapData.urlset.url.map((entry) => ({
            loc: entry.loc[0],
            lastmod: entry.lastmod ? entry.lastmod[0] : null,
        }));

        console.log(`Found ${urls.length} URLs in sitemap`);

        let existingProducts = [];
        try {
            // Check if products.json exists and read it
            const existingData = await fs.readFile('products.json', 'utf8');
            existingProducts = JSON.parse(existingData);
            console.log(`Loaded ${existingProducts.length} existing products`);
        } catch (error) {
            console.log('No existing products.json found, starting fresh.');
        }

        let urlsToCrawl = urls.filter(url =>
            !existingProducts.some(product => product.url === url.loc)
        );

        console.log(`Starting to crawl ${urlsToCrawl.length} new URLs...`);
        const products = [...existingProducts];
        let crawledCount = 0;

        let lastId = existingProducts.length > 0 ? Math.max(...existingProducts.map(p => p.id)) : 0;

        while (crawledCount < 60 && urlsToCrawl.length > 0) {
            const { loc } = urlsToCrawl.shift();

            try {
                console.log(`Crawling: ${loc}`);

                const delayTime = Math.random() * 2000 + 2000;
                await delay(delayTime);

                const response = await page.goto(loc, {
                    waitUntil: 'networkidle2',
                    timeout: 60000
                });

                if (!response.ok()) {
                    console.warn(`HTTP ${response.status()} for ${loc}`);
                    continue;
                }

                await page.waitForSelector('body', { timeout: 15000 });

                const product = await page.evaluate(() => {
                    const bodyText = document.body.textContent || '';

                    // ---- PRODUCT DATA DETAILS ----
                    let name = document.title || '';
                    if (name.includes('- Nhà thuốc Long Châu')) {
                        name = name.replace(/\s*-\s*Nhà thuốc Long Châu.*$/i, '').trim();
                    }

                    let price = '';
                    const priceElement = document.querySelector('span.umd\\:text-heading1.omd\\:text-title1.omd\\:font-semibold.font-bold');
                    if (priceElement) {
                        price = priceElement.textContent.trim().replace(/[^\d.₫]/g, '');
                    } else {
                        console.log('Price element not found');
                    }

                    let description = '';
                    const descMatch = bodyText.match(/Mô tả ngắn\s*([^]*?)(?=Quy cách|Xuất xứ|Thông tin|Cách dùng|$)/i);
                    if (descMatch && descMatch[1]) {
                        description = descMatch[1].trim().replace(/\s+/g, ' ').substring(0, 300);
                    }

                    let category = 'Not found';
                    const categoryRows = document.querySelectorAll('table.content-list tr.content-container');
                    for (const row of categoryRows) {
                        const cells = row.querySelectorAll('td');
                        if (cells.length >= 2) {
                            const firstCell = cells[0];
                            const secondCell = cells[1];
                            if (firstCell && firstCell.textContent && firstCell.textContent.includes('Danh mục')) {
                                if (secondCell && secondCell.textContent) {
                                    category = secondCell.textContent.trim().replace(/\s+/g, ' ').substring(0, 200);
                                    break;
                                }
                            }
                        }
                    }

                    let image = document.querySelector('img.h-full.w-full.object-contain.gallery-img.slide-active')?.src || 'Not found';
                    if (image && !image.startsWith('http')) {
                        const baseUrl = window.location.origin;
                        image = new URL(image, baseUrl).href;
                    }

                    // If no found, generate a random rating from 1 to 5
                    let rating = document.querySelector('span.text-body2.text-gray-7.inline-flex.items-center')?.textContent || Math.floor(Math.random() * 4 + 1);

                    // If no found, generate a random review count from 1 to 100
                    let reviewCount = document.querySelector('span.text-body2.text-blue-5.cursor-pointer')?.textContent || Math.floor(Math.random() * 100) + 1;

                    let brandName = document.querySelector('div.flex.flex-col.gap-2 div.font-medium span:last-child')?.textContent || 'Not found';

                    return name ? { name, price, description, category, image, rating, reviewCount, brandName } : null;
                    // ---- ENDING PRODUCT DATA DETAILS ----
                });

                if (product && product.price) {
                    // In this case Long Chau has no stock, so i generated a random stock for the website
                    const stock = generateRandomStock();
                    lastId++;
                    products.push({
                        id: lastId,
                        url: loc,
                        ...product,
                        stock,
                        crawledAt: new Date().toISOString()
                    });
                    await delay(1000); // Delay to avoid being blocked
                    // ----- LOG DETAILS -----
                    crawledCount++;
                    console.log(`✅ Extracted: ${product.name.substring(0, 50)}...`);
                    console.log(`  ID: ${lastId}`);
                    console.log(`  Price: ${product.price}`);
                    console.log(`  Stock: ${stock}`);
                    console.log(`  Description: ${product.description ? product.description.substring(0, 100) + '...' : 'No description'}`);
                    console.log(`  Category: ${product.category || 'No category'}`);
                    console.log(`  Rating: ${product.rating || 'No rating'}`);
                    console.log(`  Reviews: ${product.reviewCount || 'No reviews'}`);
                    console.log(`  Brand: ${product.brandName || 'No brand'}`);
                    console.log(`  Image: ${product.image ? product.image.substring(0, 80) + '...' : 'No image'}`);
                } else {
                    console.log(`⚠️ No price or invalid product data for ${loc}, skipping...⚠️`);
                }

            } catch (error) {
                console.warn(`Failed to crawl ${loc}: ${error.message}`);
                await delay(5000);
            }
        }
        // ----- ENDING LOG DETAILS -----

        await fs.writeFile('products.json', JSON.stringify(products, null, 2));
        console.log(`\nCrawling completed. Total products: ${products.length}`);

        if (crawledCount < 20) {
            console.log(`Only ${crawledCount} products crawled. Need more URLs to reach 20.`);
        }
    } catch (error) {
        console.error('Error during crawling:', error);
        throw new Error(`Failed to crawl sitemap: ${error.message}`);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

(async () => {
    try {
        console.log('\n=== Starting sitemap crawl ===');
        await crawlLongChauSitemap();
    } catch (error) {
        console.error('Crawler failed:', error);
    }
})();


