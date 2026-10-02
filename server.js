/**
 * ============================================================================
 *               EASYFLY TRANSIT - SYSTEME CORE LOGISTIQUE & SÛRETÉ
 * ============================================================================
 * Fichier : server.js
 * Description : Backend centralisé (Gestion des flux, Traitement des poids, 
 *               Sûreté Rayon X et Moteur d'impression Thermique 80mm).
 * ============================================================================
 */

const express = require('express');
const PDFDocument = require('pdfkit');
const cors = require('cors');

const app = express();

app.use(express.json());
app.use(cors()); // Permet aux front-ends d'interroger les routes API

// CONFIGURATION LOGIQUE : TARIF LOCAL EXCÉDENT DE POIDS À KINSHASA
// Équivalent d'environ 15 USD en Francs Congolais (CDF) par Kilogramme excédentaire
const CDF_PER_KG_EXCESS = 42000;

// SIMULATION DE LA BASE DE DONNÉES CENTRALE (EN PRODUCTION : SUPABASE / POSTGRESQL)
let DB_BAGGAGE = {
    "bag-001": {
        baggage_id: "bag-001",
        pnr_code: "AF-29401",
        passenger_name: "MUTOMBO ILUNGA Patrick",
        flight_number: "AF 898",
        destination: "Paris CDG",
        allowed_weight: 23.00,
        measured_weight: 0.00,
        excess_weight: 0.00,
        excess_fee_cdf: 0,
        payment_status: "Pending",     // Pending, Paid_Cash, Paid_POS, Paid_MobileMoney
        payment_method: "None",        // None, Cash, POS_Card, Mobile_Money
        transaction_reference: null,
        xray_status: "Pending",        // Pending, Approved, Suspect
        security_seal_number: null,
        current_status: "Registered at Hub", // Registered, X-Ray Certified, Sealed, In Transit
        batch_reference: "BT-2026-093",
        updated_at: "02/10/2026 10:16"
    }
};

/**
 * API 1 : ENREGISTREMENT DE LA PESÉE & FLUX DE CAISSE (GUICHET PROCOKI)
 * POST /api/baggage/weigh
 */
app.post('/api/baggage/weigh', (req, res) => {
    const { baggage_id, measured_weight, payment_method, transaction_reference } = req.body;
    
    if (!DB_BAGGAGE[baggage_id]) {
        return res.status(404).json({ success: false, message: "Bagage introuvable dans le système." });
    }

    let bag = DB_BAGGAGE[baggage_id];
    bag.measured_weight = parseFloat(measured_weight);
    
    // Calcul automatique de l'assiette de surtaxe
    if (bag.measured_weight > bag.allowed_weight) {
        bag.excess_weight = bag.measured_weight - bag.allowed_weight;
        bag.excess_fee_cdf = Math.round(bag.excess_weight * CDF_PER_KG_EXCESS);
        
        if (['Cash', 'POS_Card'].includes(payment_method) && transaction_reference) {
            bag.payment_status = `Paid_${payment_method}`;
            bag.payment_method = payment_method;
            bag.transaction_reference = transaction_reference;
        } else if (payment_method === 'Mobile_Money') {
            bag.payment_status = "Pending_Mobile_Push";
            bag.payment_method = "Mobile_Money";
        } else {
            bag.payment_status = "Pending_Payment_Required";
        }
    } else {
        bag.excess_weight = 0.00;
        bag.excess_fee_cdf = 0;
        bag.payment_status = "Paid_Ok";
    }

    bag.updated_at = new Date().toISOString();
    return res.status(200).json({ success: true, data: bag });
});

/**
 * API 2 : CERTIFICATION DE SÛRETÉ RAYON X & PLOMBAGE ÉLECTRONIQUE
 * POST /api/baggage/xray-inspect
 */
app.post('/api/baggage/xray-inspect', (req, res) => {
    const { baggage_id, xray_status, security_seal_number } = req.body;

    if (!DB_BAGGAGE[baggage_id]) {
        return res.status(404).json({ success: false, message: "Bagage introuvable." });
    }

    let bag = DB_BAGGAGE[baggage_id];
    
    if (!['Approved', 'Suspect'].includes(xray_status)) {
        return res.status(400).json({ success: false, message: "Statut de contrôle de sûreté invalide." });
    }

    bag.xray_status = xray_status;
    
    if (xray_status === 'Approved') {
        if (!security_seal_number) {
            return res.status(400).json({ success: false, message: "Un scellé physique est requis pour valider la conformité." });
        }
        bag.security_seal_number = security_seal_number;
        bag.current_status = "X-Ray Certified & Sealed";
    } else {
        bag.current_status = "Flagged / Refused for Security";
        bag.security_seal_number = null;
    }

    bag.updated_at = new Date().toISOString();
    return res.status(200).json({ success: true, data: bag });
});

/**
 * API 3 : EXPÉDITION DU BATCH LOGISTIQUE VERS L'AÉROPORT DE N'DJILI
 * POST /api/batch/dispatch
 */
app.post('/api/batch/dispatch', (req, res) => {
    const { batch_reference, truck_seal_number } = req.body;

    if (!truck_seal_number) {
        return res.status(400).json({ success: false, message: "Numéro de plombage du camion requis." });
    }

    let itemsUpdated = 0;
    for (let id in DB_BAGGAGE) {
        if (DB_BAGGAGE[id].batch_reference === batch_reference && DB_BAGGAGE[id].xray_status === 'Approved') {
            DB_BAGGAGE[id].current_status = "In Transit to Ndjili";
            itemsUpdated++;
        }
    }

    return res.status(200).json({
        success: true,
        message: `Convoi sécurisé validé. ${itemsUpdated} bagages verrouillés sous le scellé camion ${truck_seal_number}.`,
        batch: batch_reference,
        truck_seal: truck_seal_number
    });
});

/**
 * API 4 : FLUX GÉNÉRATEUR DE TICKET - CONFIGURATION SOUCHE THERMIQUE 80MM
 * GET /api/tickets/print/:baggage_id
 */
app.get('/api/tickets/print/:baggage_id', (req, res) => {
    const bag = DB_BAGGAGE[req.params.baggage_id];

    if (!bag) {
        return res.status(404).send("Erreur : Aucun reçu disponible pour cet identifiant.");
    }

    // Standard 80mm de largeur = 226.77 points PostScript, hauteur adaptative 450 points
    const doc = new PDFDocument({
        size: [226.77, 450],
        margins: { top: 12, bottom: 12, left: 10, right: 10 }
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=ticket_${bag.baggage_id}.pdf`);
    doc.pipe(res);

    // EN-TÊTE TICKET
    doc.fontSize(10).font('Helvetica-Bold').text("EASYFLY TRANSIT SARL", { align: 'center' });
    doc.fontSize(6).font('Helvetica').text("Hub Concession PROCOKI - Gombe, Kinshasa", { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(8).text("--------------------------------------------------", { align: 'center' });
    doc.moveDown(0.3);

    // Section Identité & Itinéraire
    doc.fontSize(8).font('Helvetica-Bold').text(`PASSAGER : ${bag.passenger_name}`);
    doc.font('Helvetica').text(`VOL : ${bag.flight_number} | PNR : ${bag.pnr_code}`);
    doc.text(`DESTINATION : ${bag.destination}`);
    doc.text(`DATE : ${bag.updated_at.substring(0, 10)}`);
    doc.moveDown(0.3);
    doc.text("--------------------------------------------------", { align: 'center' });
    doc.moveDown(0.3);

    // Traçabilité Sûreté
    doc.fontSize(8).font('Helvetica-Bold').text(`SÛRETÉ : ${bag.xray_status === 'Approved' ? 'CONFORME (SCAN OK)' : 'EN ATTENTE'}`);
    doc.font('Helvetica-Oblique').text(`SCELLÉ : ${bag.security_seal_number || 'Non apposé'}`);
    doc.moveDown(0.3);
    doc.font('Helvetica').text("--------------------------------------------------", { align: 'center' });
    doc.moveDown(0.3);

    // Relevé Balance & Caisse
    doc.fontSize(7).text(`Franchise : ${bag.allowed_weight.toFixed(2)} kg`);
    doc.text(`Pesée : ${bag.measured_weight.toFixed(2)} kg`);
    doc.fontSize(8).font('Helvetica-Bold').text(`Excédent : +${bag.excess_weight.toFixed(2)} kg`);
    doc.moveDown(0.2);
    doc.fontSize(9).text(`ENCAISSÉ : ${bag.excess_fee_cdf.toLocaleString()} CDF`);
    doc.fontSize(7).font('Helvetica').text(`Règlement : ${bag.payment_method}`);
    doc.text(`Réf : ${bag.transaction_reference || 'N/A'}`);
    doc.moveDown(0.4);
    doc.text("--------------------------------------------------", { align: 'center' });
    doc.moveDown(0.3);

    // Notice Sûreté
    doc.fontSize(5.5).font('Helvetica-Oblique').text(
        "Ce bagage a fait l'objet d'un contrôle Rayon X déporté. Scellé inviolable obligatoire pour admission au guichet de l'Aéroport International de N'Djili.",
        { align: 'justify', width: 206 }
    );

    doc.moveDown(0.6);
    doc.fontSize(8).font('Helvetica-Bold').text("BON VOYAGE - NDJILI EXPRESS", { align: 'center' });

    doc.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[EASYFLY CORE] Serveur actif sur le port ${PORT}`));