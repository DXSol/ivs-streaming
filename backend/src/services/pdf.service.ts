import puppeteer, { Browser } from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';

export interface InvoiceData {
  invoiceNumber: string;
  invoiceDate: Date;
  customerName: string;
  customerEmail: string;
  customerAddress: string;
  eventTitle?: string;
  invoiceType: 'event_ticket' | 'season_ticket';
  subtotalPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  currency: string;
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyGstin: string;
  sacCode: string;
  razorpayPaymentId?: string;
}

// Singleton browser instance for better performance
let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserInstance || !browserInstance.connected) {
    console.log('[PDF Service] Launching Puppeteer browser...');

    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;

    browserInstance = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
      executablePath,
    });

    console.log('[PDF Service] Browser launched successfully');
  }

  return browserInstance;
}

// Number to words conversion (Indian numbering system)
function numberToWords(num: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  if (num === 0) return 'Zero';

  const convertLessThanThousand = (n: number): string => {
    if (n === 0) return '';
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + convertLessThanThousand(n % 100) : '');
  };

  // Indian numbering system: Crore, Lakh, Thousand, Hundred
  let result = '';
  const crore = Math.floor(num / 10000000);
  const lakh = Math.floor((num % 10000000) / 100000);
  const thousand = Math.floor((num % 100000) / 1000);
  const remainder = num % 1000;

  if (crore > 0) {
    result += convertLessThanThousand(crore) + ' Crore ';
  }
  if (lakh > 0) {
    result += convertLessThanThousand(lakh) + ' Lakh ';
  }
  if (thousand > 0) {
    result += convertLessThanThousand(thousand) + ' Thousand ';
  }
  if (remainder > 0) {
    result += convertLessThanThousand(remainder);
  }

  return result.trim();
}

function getAmountInWords(totalPaise: number): string {
  const rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;

  let result = 'Rupees ' + numberToWords(rupees);
  if (paise > 0) {
    result += ' and ' + numberToWords(paise) + ' Paise';
  }
  result += ' Only';
  return result;
}

function formatCurrency(paise: number): string {
  return (paise / 100).toFixed(2);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

function getInvoiceTypeLabel(type: 'event_ticket' | 'season_ticket'): string {
  return type === 'season_ticket' ? 'Season Ticket' : 'Event Ticket';
}

export async function generateInvoicePDF(invoiceData: InvoiceData): Promise<Buffer> {
  try {
    console.log(`[PDF Service] Generating PDF for invoice ${invoiceData.invoiceNumber}...`);

    // Load HTML template
    const templatePath = path.join(__dirname, '../templates/invoice-pdf.html');
    let html = fs.readFileSync(templatePath, 'utf-8');

    // Load and convert logo to base64
    const logoPath = path.join(__dirname, '../templates/hope-logo.png');
    let logoBase64 = '';

    if (fs.existsSync(logoPath)) {
      const logoBuffer = fs.readFileSync(logoPath);
      logoBase64 = `data:image/png;base64,${logoBuffer.toString('base64')}`;
    }

    // Format currency values
    const subtotal = formatCurrency(invoiceData.subtotalPaise);
    const cgst = formatCurrency(invoiceData.cgstPaise);
    const sgst = formatCurrency(invoiceData.sgstPaise);
    const igst = formatCurrency(invoiceData.igstPaise);
    const total = formatCurrency(invoiceData.totalPaise);

    // Build conditional rows
    const cgstRow = invoiceData.cgstPaise > 0
      ? `<div class="summary-row"><span>CGST (9%)</span><span>₹${cgst}</span></div>`
      : '';

    const sgstRow = invoiceData.sgstPaise > 0
      ? `<div class="summary-row"><span>SGST (9%)</span><span>₹${sgst}</span></div>`
      : '';

    const igstRow = invoiceData.igstPaise > 0
      ? `<div class="summary-row"><span>IGST (18%)</span><span>₹${igst}</span></div>`
      : '';

    const eventTitleBlock = invoiceData.eventTitle
      ? `<span class="event-name"> - ${invoiceData.eventTitle}</span>`
      : '';

    // Replace placeholders
    html = html
      .replace(/{{logoBase64}}/g, logoBase64)
      .replace(/{{companyName}}/g, invoiceData.companyName)
      .replace(/{{companyAddress}}/g, invoiceData.companyAddress)
      .replace(/{{companyPhone}}/g, invoiceData.companyPhone)
      .replace(/{{companyGstin}}/g, invoiceData.companyGstin)
      .replace(/{{invoiceNumber}}/g, invoiceData.invoiceNumber)
      .replace(/{{invoiceDate}}/g, formatDate(invoiceData.invoiceDate))
      .replace(/{{customerName}}/g, invoiceData.customerName || 'Customer')
      .replace(/{{invoiceTypeLabel}}/g, getInvoiceTypeLabel(invoiceData.invoiceType))
      .replace(/{{eventTitleBlock}}/g, eventTitleBlock)
      .replace(/{{sacCode}}/g, invoiceData.sacCode || '999629')
      .replace(/{{subtotal}}/g, subtotal)
      .replace(/{{cgstRow}}/g, cgstRow)
      .replace(/{{sgstRow}}/g, sgstRow)
      .replace(/{{igstRow}}/g, igstRow)
      .replace(/{{total}}/g, total)
      .replace(/{{amountInWords}}/g, getAmountInWords(invoiceData.totalPaise));

    // Get browser instance
    const browser = await getBrowser();

    // Create new page
    const page = await browser.newPage();

    try {
      // Set content and wait for it to load
      await page.setContent(html, { waitUntil: 'networkidle0' });

      // Generate PDF
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '10mm',
          bottom: '10mm',
          left: '10mm',
          right: '10mm',
        },
      });

      console.log(`[PDF Service] PDF generated successfully for invoice ${invoiceData.invoiceNumber}`);

      return Buffer.from(pdfBuffer);
    } finally {
      // Always close the page to prevent memory leaks
      await page.close();
    }
  } catch (error) {
    console.error('[PDF Service] Error generating PDF:', error);
    throw error;
  }
}

// Cleanup function to close browser when server shuts down
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    console.log('[PDF Service] Closing browser...');
    await browserInstance.close();
    browserInstance = null;
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  await closeBrowser();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeBrowser();
  process.exit(0);
});
