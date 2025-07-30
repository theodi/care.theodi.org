const fs = require('fs');
const path = require('path');

// Test script to validate template and basic docx functionality
async function testTemplate() {
    console.log('Testing template file...');
    
    const templatePath = './public/data/template.docx';
    
    // Check if template exists
    if (!fs.existsSync(templatePath)) {
        console.error('Template file not found:', templatePath);
        return;
    }
    
    // Check template file size
    const stats = fs.statSync(templatePath);
    console.log('Template file size:', stats.size, 'bytes');
    
    if (stats.size < 1000) {
        console.error('Template file is too small, likely corrupted');
        return;
    }
    
    // Try to read the template
    try {
        const templateBuffer = fs.readFileSync(templatePath);
        console.log('Template read successfully, buffer size:', templateBuffer.length);
        
        // Check if it's a valid ZIP file (DOCX files are ZIP archives)
        const zipHeader = templateBuffer.slice(0, 4);
        const isZip = zipHeader[0] === 0x50 && zipHeader[1] === 0x4B && 
                     zipHeader[2] === 0x03 && zipHeader[3] === 0x04;
        
        console.log('Is valid ZIP file:', isZip);
        
        if (!isZip) {
            console.error('Template file is not a valid ZIP file (DOCX requirement)');
        }
        
    } catch (error) {
        console.error('Error reading template:', error);
    }
}

// Test basic docx functionality
async function testDocx() {
    console.log('\nTesting basic docx functionality...');
    
    try {
        const docx = require('docx');
        console.log('docx package loaded successfully');
        
        // Test creating a simple document
        const doc = new docx.Document({
            sections: [{
                properties: {},
                children: [
                    new docx.Paragraph({
                        children: [
                            new docx.TextRun({
                                text: "Test document",
                                bold: true,
                            }),
                        ],
                    }),
                ],
            }],
        });
        
        const buffer = await docx.Packer.toBuffer(doc);
        console.log('Simple document created successfully, size:', buffer.length, 'bytes');
        
        if (buffer.length < 1000) {
            console.error('Generated document is too small');
        } else {
            console.log('Basic docx functionality working correctly');
        }
        
    } catch (error) {
        console.error('Error testing docx functionality:', error);
    }
}

// Run tests
async function runTests() {
    await testTemplate();
    await testDocx();
}

runTests().catch(console.error); 