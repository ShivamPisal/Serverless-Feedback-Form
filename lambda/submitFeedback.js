import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const REGION = process.env.AWS_REGION || process.env.REGION || "us-east-1";
const TABLE_NAME = process.env.TABLE_NAME || "Feedback-Kobina";
const BUCKET_NAME = process.env.BUCKET_NAME || "feedback-images-kobbyjust";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "sagarinokoeaws1@gmail.com";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const MAX_PDF_SIZE_BYTES = Number.parseInt(process.env.MAX_PDF_SIZE_BYTES || `${5 * 1024 * 1024}`, 10);
const PRESIGNED_URL_TTL_SECONDS = 60 * 60 * 24;

const dynamoClient = new DynamoDBClient({ region: REGION });
const documentClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({ region: REGION });
const sesClient = new SESClient({ region: REGION });

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

const buildResponse = (statusCode, body) => ({
  statusCode,
  headers: corsHeaders,
  body: JSON.stringify(body),
});

const parseEventBody = (event) => {
  if (typeof event?.body === "string") {
    return JSON.parse(event.body);
  }

  if (event?.body && typeof event.body === "object") {
    return event.body;
  }

  if (event?.name && event?.email) {
    return event;
  }

  return null;
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const sanitizeText = (value) => String(value ?? "").trim().replace(/\r\n/g, "\n");

const buildValidationError = (message) => {
  const error = new Error(message);
  error.name = "ValidationError";
  return error;
};

const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const validateAndNormalizePayload = (body) => {
  const name = sanitizeText(body?.name);
  const email = sanitizeText(body?.email).toLowerCase();
  const message = sanitizeText(body?.message);
  const fileBase64 = typeof body?.file_base64 === "string" && body.file_base64.trim() ? body.file_base64.trim() : null;

  if (!name || !email || !message) {
    throw buildValidationError("Name, email, and message are required.");
  }

  if (name.length > 120) {
    throw buildValidationError("Name is too long.");
  }

  if (!validateEmail(email)) {
    throw buildValidationError("Please enter a valid email address.");
  }

  if (message.length > 5000) {
    throw buildValidationError("Message is too long.");
  }

  return { name, email, message, fileBase64 };
};

const decodePdf = (fileBase64) => {
  const normalized = fileBase64.split(",").pop()?.trim();

  if (!normalized) {
    throw buildValidationError("Attachment data is invalid.");
  }

  if (!/^[A-Za-z0-9+/=]+$/.test(normalized)) {
    throw buildValidationError("Attachment must be a valid base64-encoded PDF.");
  }

  const pdfData = Buffer.from(normalized, "base64");

  if (!pdfData.length) {
    throw buildValidationError("Attachment data is invalid.");
  }

  if (!pdfData.subarray(0, 4).equals(Buffer.from("%PDF"))) {
    throw buildValidationError("Only PDF attachments are allowed.");
  }

  if (pdfData.length > MAX_PDF_SIZE_BYTES) {
    throw buildValidationError(`PDF attachment must be ${Math.floor(MAX_PDF_SIZE_BYTES / (1024 * 1024))} MB or smaller.`);
  }

  return pdfData;
};

const uploadPdfAndGetUrl = async (feedbackId, fileBase64) => {
  if (!fileBase64) {
    return null;
  }

  const key = `${feedbackId}.pdf`;
  const pdfData = decodePdf(fileBase64);

  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: pdfData,
      ContentType: "application/pdf",
      ServerSideEncryption: "AES256",
    }),
  );

  return getSignedUrl(
    s3Client,
    new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    }),
    { expiresIn: PRESIGNED_URL_TTL_SECONDS },
  );
};

const saveFeedback = async ({ feedbackId, name, email, message, fileUrl }) => {
  await documentClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        feedback_id: feedbackId,
        name,
        email,
        message,
        file_url: fileUrl,
        timestamp: new Date().toISOString(),
      },
    }),
  );
};

const sendEmail = async ({ toAddresses, subject, htmlBody, textBody }) => {
  await sesClient.send(
    new SendEmailCommand({
      Source: ADMIN_EMAIL,
      Destination: {
        ToAddresses: toAddresses,
      },
      Message: {
        Subject: {
          Data: subject,
        },
        Body: {
          Html: {
            Data: htmlBody,
          },
          Text: {
            Data: textBody,
          },
        },
      },
    }),
  );
};

const sendAdminEmail = async ({ name, email, message, fileUrl }) => {
  const escapedName = escapeHtml(name);
  const escapedEmail = escapeHtml(email);
  const escapedMessage = escapeHtml(message).replace(/\n/g, "<br>");
  const escapedFileUrl = fileUrl ? escapeHtml(fileUrl) : null;
  const attachmentRow = fileUrl
    ? `
      <tr>
        <td class="label">Attachment</td>
        <td><a href="${escapedFileUrl}" target="_blank" rel="noopener noreferrer" class="file-link">View PDF Attachment</a></td>
      </tr>
    `
    : "";

  const htmlBody = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body {
            font-family: Helvetica, Arial, sans-serif;
            background-color: #f1f5f9;
            padding: 40px 0;
          }
          .container {
            max-width: 600px;
            margin: auto;
            background-color: #ffffff;
            border-radius: 10px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
            padding: 30px;
          }
          h2 {
            color: #1d4ed8;
            border-bottom: 2px solid #e2e8f0;
            padding-bottom: 10px;
            margin-bottom: 20px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
          }
          td {
            padding: 12px 10px;
            vertical-align: top;
            border-bottom: 1px solid #e2e8f0;
          }
          td.label {
            font-weight: bold;
            background-color: #f8fafc;
            width: 30%;
            color: #475569;
          }
          .message {
            white-space: pre-wrap;
          }
          .file-link {
            color: #2563eb;
            font-weight: bold;
            text-decoration: none;
          }
          .file-link:hover {
            text-decoration: underline;
          }
          .footer {
            margin-top: 30px;
            font-size: 12px;
            color: #94a3b8;
            text-align: center;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>New Feedback Received</h2>
          <table>
            <tr>
              <td class="label">Name</td>
              <td>${escapedName}</td>
            </tr>
            <tr>
              <td class="label">Email</td>
              <td>${escapedEmail}</td>
            </tr>
            <tr>
              <td class="label">Message</td>
              <td class="message">${escapedMessage}</td>
            </tr>
            ${attachmentRow}
          </table>
          <div class="footer">
            This email was automatically sent from your feedback form.
          </div>
        </div>
      </body>
    </html>
  `;

  const textBody = [
    "New Feedback Received",
    "",
    `Name: ${name}`,
    `Email: ${email}`,
    "",
    "Message:",
    message,
    fileUrl ? "" : null,
    fileUrl ? `Attachment: ${fileUrl}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  await sendEmail({
    toAddresses: [ADMIN_EMAIL],
    subject: "New Feedback Received",
    htmlBody,
    textBody,
  });
};

const sendThankYouEmail = async ({ name, email }) => {
  const escapedName = escapeHtml(name);
  const greetingName = escapedName || "there";
  const htmlBody = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body {
            font-family: Helvetica, Arial, sans-serif;
            background-color: #f8fafc;
            padding: 32px 0;
            color: #0f172a;
          }
          .container {
            max-width: 560px;
            margin: auto;
            background-color: #ffffff;
            border-radius: 12px;
            border: 1px solid #e2e8f0;
            padding: 32px;
          }
          h2 {
            margin-top: 0;
            margin-bottom: 16px;
            color: #1d4ed8;
          }
          p {
            margin: 0 0 14px;
            line-height: 1.6;
            color: #334155;
          }
          .footer {
            margin-top: 24px;
            font-size: 12px;
            color: #94a3b8;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>Thank you for your feedback</h2>
          <p>Hi ${greetingName},</p>
          <p>Thank you for taking the time to share your feedback with us. We have received your message successfully.</p>
          <p>Our team will review it and use it to improve the experience we provide.</p>
          <p class="footer">This is an automated confirmation email.</p>
        </div>
      </body>
    </html>
  `;

  const textBody = [
    "Thank you for your feedback",
    "",
    `Hi ${name || "there"},`,
    "",
    "Thank you for taking the time to share your feedback with us.",
    "We have received your message successfully.",
    "",
    "Our team will review it and use it to improve the experience we provide.",
    "",
    "This is an automated confirmation email.",
  ].join("\n");

  await sendEmail({
    toAddresses: [email],
    subject: "Thank you for your feedback",
    htmlBody,
    textBody,
  });
};

export const handler = async (event) => {
  console.log("Event received:", JSON.stringify(event));

  if (event?.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: corsHeaders,
    };
  }

  try {
    const body = parseEventBody(event);

    if (!body) {
      return buildResponse(400, { message: "Invalid request format." });
    }

    const feedbackId = randomUUID();
    const { name, email, message, fileBase64 } = validateAndNormalizePayload(body);

    const fileUrl = await uploadPdfAndGetUrl(feedbackId, fileBase64);

    await saveFeedback({
      feedbackId,
      name,
      email,
      message,
      fileUrl,
    });

    await sendAdminEmail({
      name,
      email,
      message,
      fileUrl,
    });

    await sendThankYouEmail({
      name,
      email,
    });

    return buildResponse(200, { message: "Feedback submitted successfully" });
  } catch (error) {
    console.error("Error occurred:", error);
    const isValidationError = error instanceof Error && error.name === "ValidationError";
    return buildResponse(isValidationError ? 400 : 500, {
      message: isValidationError ? error.message : "Internal server error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
