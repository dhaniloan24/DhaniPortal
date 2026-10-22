# Dhani Portal — loan application portal

Node.js/Express application with PostgreSQL storage, customer application submission, file uploads, reference numbers, mobile-verified status lookup, admin login/editing, and optional SMTP email.

## Before you deploy

This is a deployable starter, not a licensed lending service or a guarantee of regulatory compliance. Operate under a legal entity and use the Dhani name/logo only if you are authorized to do so. Replace the privacy notice with reviewed legal disclosures before collecting real customer data. Do not use the portal to represent an application as approved unless an authorized lender has actually made that decision.

## Features

- Mobile-responsive public site and loan categories
- Application form with applicant photo, signature, and supporting document upload
- Unique application reference number
- Customer status lookup requiring reference number + registered mobile number
- Admin authentication using a bcrypt password hash and server-side session
- Admin application list, private document download, status/approved amount/note editing
- Optional SMTP emails to applicant and administrator
- PostgreSQL data and session storage; file upload storage configurable by `UPLOAD_DIR`
- Rate limits, secure cookie settings, Helmet headers, upload size/type restrictions

Allowed application statuses: `Received`, `Under Review`, `Documents Required`, `Approved`, `Rejected`, `Disbursed`.

## Requirements

- Node.js 20+
- PostgreSQL database
- Persistent storage for uploaded files in production (Render disk or private object storage)
- SMTP credentials for email notifications (optional but recommended)

## Local setup

1. Install Node.js 20+ and PostgreSQL.
2. Create a PostgreSQL database, for example `dhani_portal`.
3. Copy `.env.example` to `.env` and fill the values.
4. Generate a bcrypt hash for the admin password:

   ```bash
   node -e "require('bcryptjs').hash(process.argv[1], 12).then(console.log)" "Choose-A-Long-Unique-Password"
   ```

   Put the resulting hash in `ADMIN_PASSWORD_HASH`. Do not use the example password above.
5. Run:

   ```bash
   npm install
   npm start
   ```

6. Visit `http://localhost:3000`. Admin page: `http://localhost:3000/admin.html`.

## Render deployment

1. Push the project to a private GitHub repository.
2. Create a PostgreSQL database in Render (or use a secured external PostgreSQL provider). Set `DATABASE_URL` to its **internal** connection URL when the web service and database are in the same Render region.
3. Create a Web Service from the repository. Build command: `npm install`; start command: `npm start`; health check: `/health`.
4. Add environment variables from `.env.example` in Render. Generate a unique `SESSION_SECRET` (at least 32 random characters) and set `ADMIN_PASSWORD_HASH` to a bcrypt hash.
5. Add a persistent disk mounted at `/var/data`; set `UPLOAD_DIR=/var/data/uploads`. The `render.yaml` file describes a starter service and disk, but verify the plan and costs in your Render account before deploying.
6. Set `APP_BASE_URL` to the actual HTTPS Render URL. Configure SMTP variables for email delivery.
7. Test `/health`, submit a test application with dummy data, verify status lookup, admin login, file download, and email delivery before any real use.

**Important:** Do not use an ephemeral filesystem for real uploaded documents. Render's local filesystem can be reset during deploy/restart unless a persistent disk is attached. Back up the database and uploaded files and set a retention policy.

## Environment variables

See `.env.example`. `ADMIN_PASSWORD_HASH` must be a bcrypt hash, not a plaintext password. Do not commit `.env`, database credentials, SMTP passwords, uploaded documents, or customer data to GitHub.

## Operational security checklist

- Replace the privacy notice with accurate legal and grievance disclosures.
- Use HTTPS only; set a unique `SESSION_SECRET` and strong admin password.
- Limit admin access to authorized staff; rotate credentials when staff leave.
- Set database/file backups and retention/deletion policies.
- Confirm consent, lawful purpose, data minimization, access controls, and applicable Indian data protection and lending requirements with qualified counsel.
- Consider malware scanning and private object storage for uploaded files.
- Review audit logging, recovery procedures, and production monitoring before launch.

## Known limits to address before high-volume/regulated production

- One admin account is configured via environment variables; there is no multi-user role management or password-reset workflow.
- Upload validation checks file extension and browser-provided MIME type; production should add content-based file signature validation and malware scanning.
- The portal stores files on the configured disk; secure backups and lifecycle deletion need to be operated by the owner.
- Application status lookup uses reference number plus registered phone; consider OTP verification for stronger customer authentication.
- No loan decision is automated. An admin-recorded status is not a lender commitment unless made by the authorized lender.
