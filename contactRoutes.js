import express from "express";
import pool from "./db.js";
import nodemailer from "nodemailer";

const router = express.Router();

// POST /contact/send
router.post("/send", async (req, res) => {
  try {
    const { name, email, message } = req.body;
    if (!name || !email || !message) {
      return res.status(400).json({ error: "All fields are required" });
    }

    // Save in DB
    await pool.query(
      "INSERT INTO contact_messages (name, email, message) VALUES($1, $2, $3)",
      [name, email, message]
    );

    // Email notification
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: email,
      to: process.env.MAIL_USER, // receive emails in your inbox
      subject: `New Contact Query from ${name}`,
      text: message,
      html: `
        <h2>New Contact Message</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Message:</strong></p>
        <p>${message}</p>
      `,
    });

    // Auto-reply to customer
    await transporter.sendMail({
      from: process.env.MAIL_USER, // your business email
      to: email, // customer email
      subject: "Thank you for contacting DGSTECH",
      html: `
    <p>Hi <strong>${name}</strong>,</p>
    <p>Thank you for getting in touch with <strong>DGSTECH</strong>.</p>
    <p>Your message has been received and our support team will respond as soon as possible.</p>
    <br />
    <p style="margin-top:10px">Regards,<br><strong>DGSTECH Support Team</strong></p>
  `,
    });

    return res.json({ success: true, message: "Message sent successfully" });
  } catch (error) {
    console.error("Contact form error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
