// Digital seal for completed PDFs (PKCS#7 / CMS detached signature, ETSI.CAdES-compatible
// SubFilter adbe.pkcs7.detached via @signpdf).
//
// This is what makes the finished file tamper-evident: Acrobat and other readers show
// "the document has not been modified since this signature was applied", and flag any
// later change. By default each workspace gets its own self-signed sealing certificate,
// so readers show the identity as "not trusted" until it is added to their trust list.
// For automatic trust, upload a document-signing certificate from an AATL / EUTL CA in
// Settings → Security. Neither option makes the drawn signatures "qualified" signatures.

import { generateKeyPairSync, randomBytes } from "crypto";
import forge from "node-forge";
import { PDFDocument } from "pdf-lib";
import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib";
import signpdfModule from "@signpdf/signpdf";
import { P12Signer } from "@signpdf/signer-p12";
import { decryptSecret, encryptSecret } from "./crypto";

// @signpdf/signpdf ships CJS with a default export object.
const signpdf = ((signpdfModule as unknown as { default?: typeof signpdfModule }).default ?? signpdfModule) as typeof signpdfModule;

export interface SealIdentity {
  p12: Buffer;
  passphrase: string;
  certPem: string;
}

export function packIdentity(id: SealIdentity): string {
  return encryptSecret(JSON.stringify({ p12: id.p12.toString("base64"), passphrase: id.passphrase }));
}

export function unpackIdentity(enc: string, certPem: string): SealIdentity {
  const o = JSON.parse(decryptSecret(enc)) as { p12: string; passphrase: string };
  return { p12: Buffer.from(o.p12, "base64"), passphrase: o.passphrase, certPem };
}

/** Creates a self-signed RSA-2048 sealing certificate valid for 10 years. */
export function generateSealIdentity(commonName: string, organization: string): SealIdentity {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key = forge.pki.privateKeyFromPem(privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  const pub = forge.pki.setRsaPublicKey(key.n, key.e);
  const cert = forge.pki.createCertificate();
  cert.publicKey = pub;
  cert.serialNumber = "01" + randomBytes(15).toString("hex");
  const now = new Date();
  cert.validity.notBefore = new Date(now.getTime() - 60_000);
  cert.validity.notAfter = new Date(now.getTime() + 10 * 365 * 86400_000);
  const attrs = [
    { name: "commonName", value: commonName.slice(0, 64) },
    { name: "organizationName", value: organization.slice(0, 64) },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, nonRepudiation: true },
    { name: "subjectKeyIdentifier" },
  ]);
  cert.sign(key, forge.md.sha256.create());
  const passphrase = randomBytes(18).toString("base64url");
  const asn1 = forge.pkcs12.toPkcs12Asn1(key, [cert], passphrase, { algorithm: "aes256", friendlyName: commonName });
  const p12 = Buffer.from(forge.asn1.toDer(asn1).getBytes(), "binary");
  return { p12, passphrase, certPem: forge.pki.certificateToPem(cert) };
}

/** Reads the leaf certificate from an uploaded PKCS#12 file (validates the passphrase). */
export function readP12(p12: Buffer, passphrase: string): { certPem: string; subject: string; notAfter: Date } {
  let parsed: forge.pkcs12.Pkcs12Pfx;
  try {
    parsed = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(p12.toString("binary")), passphrase);
  } catch {
    throw new Error("Could not open the certificate file. Check the file and passphrase.");
  }
  const bags = parsed.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const keys = parsed.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [];
  const cert = bags.find((b) => b.cert)?.cert;
  if (!cert || !keys.length) throw new Error("The file must contain a certificate and its private key.");
  if (cert.validity.notAfter < new Date()) throw new Error("This certificate has expired.");
  return {
    certPem: forge.pki.certificateToPem(cert),
    subject: cert.subject.attributes.map((a) => `${a.shortName}=${a.value}`).join(", "),
    notAfter: cert.validity.notAfter,
  };
}

export function describeCert(certPem: string): { subject: string; issuer: string; notAfter: string; selfSigned: boolean; fingerprint: string } {
  const c = forge.pki.certificateFromPem(certPem);
  const s = c.subject.attributes.map((a) => `${a.shortName}=${a.value}`).join(", ");
  const i = c.issuer.attributes.map((a) => `${a.shortName}=${a.value}`).join(", ");
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(c)).getBytes();
  const md = forge.md.sha256.create();
  md.update(der);
  return { subject: s, issuer: i, notAfter: c.validity.notAfter.toISOString(), selfSigned: s === i, fingerprint: md.digest().toHex().toUpperCase().match(/.{2}/g)!.join(":") };
}

/** Applies an invisible digital seal to a finished PDF. Page content and page count are unchanged. */
export async function sealPdf(pdfBytes: Buffer, id: SealIdentity, meta: { reason: string; name: string; location?: string; contact?: string }): Promise<Buffer> {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const pagesBefore = doc.getPageCount();
  pdflibAddPlaceholder({
    pdfDoc: doc,
    reason: meta.reason,
    contactInfo: meta.contact ?? "",
    name: meta.name,
    location: meta.location ?? "",
    signatureLength: 16384,
  });
  if (doc.getPageCount() !== pagesBefore) throw new Error("Sealing changed the page count.");
  const withPlaceholder = Buffer.from(await doc.save({ useObjectStreams: false }));
  const signer = new P12Signer(id.p12, { passphrase: id.passphrase });
  return Buffer.from(await signpdf.sign(withPlaceholder, signer));
}
