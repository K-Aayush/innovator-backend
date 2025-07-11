const fs = require("fs").promises;
const path = require("path");

class CertificateGenerator {
  constructor() {
    this.templatePath = path.join(process.cwd(), "certificates", "templates");
    this.outputPath = path.join(process.cwd(), "certificates", "generated");

    // Ensure directories exist
    this.ensureDirectories();
  }

  async ensureDirectories() {
    try {
      await fs.mkdir(this.templatePath, { recursive: true });
      await fs.mkdir(this.outputPath, { recursive: true });
    } catch (error) {
      console.error("Error creating certificate directories:", error);
    }
  }

  // Generate HTML certificate
  generateHTMLCertificate(certificateData) {
    const {
      certificateId,
      studentName,
      courseName,
      completionDate,
      instructor,
      verificationCode,
      timeSpent,
      issuer = "Your Platform Name",
    } = certificateData;

    const formattedDate = new Date(completionDate).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Certificate of Completion - ${courseName}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Inter:wght@300;400;500;600&display=swap');
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Inter', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        
        .certificate {
            background: white;
            width: 800px;
            max-width: 100%;
            padding: 60px;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.1);
            position: relative;
            overflow: hidden;
        }
        
        .certificate::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 8px;
            background: linear-gradient(90deg, #4A90E2, #667eea, #764ba2);
        }
        
        .header {
            text-align: center;
            margin-bottom: 40px;
        }
        
        .logo {
            width: 80px;
            height: 80px;
            background: linear-gradient(135deg, #4A90E2, #667eea);
            border-radius: 50%;
            margin: 0 auto 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 32px;
            font-weight: bold;
        }
        
        .title {
            font-family: 'Playfair Display', serif;
            font-size: 36px;
            font-weight: 700;
            color: #2C3E50;
            margin-bottom: 10px;
        }
        
        .subtitle {
            font-size: 18px;
            color: #7F8C8D;
            font-weight: 300;
        }
        
        .content {
            text-align: center;
            margin: 50px 0;
        }
        
        .awarded-to {
            font-size: 16px;
            color: #7F8C8D;
            margin-bottom: 15px;
            text-transform: uppercase;
            letter-spacing: 2px;
        }
        
        .student-name {
            font-family: 'Playfair Display', serif;
            font-size: 42px;
            font-weight: 700;
            color: #2C3E50;
            margin-bottom: 30px;
            border-bottom: 3px solid #4A90E2;
            display: inline-block;
            padding-bottom: 10px;
        }
        
        .completion-text {
            font-size: 18px;
            color: #34495E;
            line-height: 1.6;
            margin-bottom: 20px;
        }
        
        .course-name {
            font-family: 'Playfair Display', serif;
            font-size: 28px;
            font-weight: 700;
            color: #4A90E2;
            margin: 20px 0;
        }
        
        .details {
            display: flex;
            justify-content: space-between;
            margin: 50px 0;
            padding: 30px;
            background: #F8F9FA;
            border-radius: 15px;
        }
        
        .detail-item {
            text-align: center;
            flex: 1;
        }
        
        .detail-label {
            font-size: 12px;
            color: #7F8C8D;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 8px;
        }
        
        .detail-value {
            font-size: 16px;
            font-weight: 600;
            color: #2C3E50;
        }
        
        .signature-section {
            display: flex;
            justify-content: space-between;
            align-items: end;
            margin-top: 60px;
        }
        
        .signature {
            text-align: center;
            flex: 1;
        }
        
        .signature-line {
            width: 200px;
            height: 2px;
            background: #BDC3C7;
            margin: 0 auto 10px;
        }
        
        .signature-label {
            font-size: 14px;
            color: #7F8C8D;
        }
        
        .verification {
            text-align: center;
            margin-top: 40px;
            padding-top: 30px;
            border-top: 1px solid #ECF0F1;
        }
        
        .verification-code {
            font-family: 'Courier New', monospace;
            font-size: 12px;
            color: #7F8C8D;
            background: #F8F9FA;
            padding: 8px 16px;
            border-radius: 6px;
            display: inline-block;
            margin-top: 10px;
        }
        
        .qr-placeholder {
            width: 80px;
            height: 80px;
            background: #ECF0F1;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            color: #7F8C8D;
            text-align: center;
        }
        
        @media print {
            body {
                background: white;
                padding: 0;
            }
            
            .certificate {
                box-shadow: none;
                border: 2px solid #ECF0F1;
            }
        }
        
        @media (max-width: 768px) {
            .certificate {
                padding: 40px 30px;
            }
            
            .title {
                font-size: 28px;
            }
            
            .student-name {
                font-size: 32px;
            }
            
            .course-name {
                font-size: 22px;
            }
            
            .details {
                flex-direction: column;
                gap: 20px;
            }
            
            .signature-section {
                flex-direction: column;
                gap: 30px;
            }
        }
    </style>
</head>
<body>
    <div class="certificate">
        <div class="header">
            <div class="logo">🎓</div>
            <h1 class="title">Certificate of Completion</h1>
            <p class="subtitle">This certifies that</p>
        </div>
        
        <div class="content">
            <p class="awarded-to">This certificate is awarded to</p>
            <h2 class="student-name">${studentName}</h2>
            
            <p class="completion-text">
                for successfully completing the online course
            </p>
            
            <h3 class="course-name">"${courseName}"</h3>
            
            <p class="completion-text">
                demonstrating dedication to continuous learning and professional development.
            </p>
        </div>
        
        <div class="details">
            <div class="detail-item">
                <div class="detail-label">Completion Date</div>
                <div class="detail-value">${formattedDate}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Time Invested</div>
                <div class="detail-value">${timeSpent || "N/A"} hours</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Certificate ID</div>
                <div class="detail-value">${certificateId}</div>
            </div>
        </div>
        
        <div class="signature-section">
            <div class="signature">
                <div class="signature-line"></div>
                <p class="signature-label">${
                  instructor?.name || "Course Instructor"
                }</p>
                <p class="signature-label" style="font-size: 12px; margin-top: 5px;">
                    ${instructor?.credentials?.join(", ") || "Instructor"}
                </p>
            </div>
            
            <div class="qr-placeholder">
                QR Code
                <br>
                Verify
            </div>
        </div>
        
        <div class="verification">
            <p style="font-size: 14px; color: #7F8C8D; margin-bottom: 10px;">
                Verify this certificate at: <strong>${issuer}</strong>
            </p>
            <div class="verification-code">
                Verification Code: ${verificationCode}
            </div>
        </div>
    </div>
</body>
</html>`;
  }

  // Save certificate as HTML file
  async saveCertificate(certificateData) {
    try {
      const html = this.generateHTMLCertificate(certificateData);
      const filename = `${certificateData.certificateId}.html`;
      const filepath = path.join(this.outputPath, filename);

      await fs.writeFile(filepath, html, "utf8");

      return {
        success: true,
        filepath,
        url: `/certificates/${filename}`,
      };
    } catch (error) {
      console.error("Error saving certificate:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // Generate certificate URL for viewing
  getCertificateUrl(certificateId) {
    return `/certificates/${certificateId}.html`;
  }

  // Generate verification URL
  getVerificationUrl(verificationCode) {
    return `/verify-certificate/${verificationCode}`;
  }
}

module.exports = new CertificateGenerator();
