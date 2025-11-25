const { v4: uuidv4 } = require('uuid');
const moment = require('moment');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const { AWS, Dynamo } = require('../../config/AWS-new');
const jobDescriptionModel = require('../../models/jobDescriptionModel');
const resumeModel = require('../../models/resumeModel');

// Configure S3
const s3 = new AWS.S3({
  region: process.env.AWS_REGION || 'ap-south-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

// Configure multer for memory storage (we'll upload to S3 manually)
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: function (req, file, cb) {
    // Only allow PDF files
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// Configure multer for bulk resume uploads
const uploadBulkResumesMiddleware = multer({
  storage: multer.memoryStorage(),
  fileFilter: function (req, file, cb) {
    // Allow PDF and DOC files for resumes
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed for resumes'), false);
    }
  }
});

// Function to upload file to S3
async function uploadToS3(file, filename) {
  const params = {
    Bucket: 'recuritez',
    Key: filename,
    Body: file.buffer,
    ContentType: 'application/pdf'
    // Removed ACL since bucket is not public
  };

  return new Promise((resolve, reject) => {
    s3.upload(params, (err, data) => {
      if (err) {
        reject(err);
      } else {
        // Return S3 URI instead of public URL
        const s3Uri = `s3://${params.Bucket}/${params.Key}`;
        resolve(s3Uri);
      }
    });
  });
}

// Function to upload resume to S3
async function uploadResumeToS3(file, filename) {
  const params = {
    Bucket: 'recuritez',
    Key: `resume/${filename}`,
    Body: file.buffer,
    ContentType: file.mimetype
  };

  return new Promise((resolve, reject) => {
    s3.upload(params, (err, data) => {
      if (err) {
        reject(err);
      } else {
        // Return S3 URI instead of public URL
        const s3Uri = `s3://${params.Bucket}/${params.Key}`;
        resolve(s3Uri);
      }
    });
  });
}

// Function to get job description details
async function getJobDescriptionDetails(jdId) {
  try {
    const params = {
      TableName: jobDescriptionModel.tableName,
      Key: {
        id: jdId
      }
    };

    const result = await Dynamo.get(params).promise();
    return result.Item;

  } catch (error) {
    console.error('Error fetching job description:', error);
    throw error;
  }
}

// Function to call AI analysis endpoint
async function callAIAnalysis(jdS3Url, resumeS3Url, jdId, hrId, profileId) {
  try {
    const aiRequestData = {
      jd_s3_url: jdS3Url,
      resume_s3_url: resumeS3Url,
      jd_id: jdId,
      hr_id: hrId,
      profile_id: profileId
    };

    console.log('Calling AI analysis endpoint with data:', aiRequestData);
console.log('triggredd1')
    const response = await axios.post('http://13.203.246.229:5000/analyze', aiRequestData, {
      headers: {
        'Content-Type': 'application/json'
      },
      // timeout: 30000 // 30 second timeout
    });

    console.log('AI analysis completed successfully for profile:', profileId);
    return {
      success: true,
      data: response.data,
      error: null
    };

  } catch (error) {
    console.error('AI analysis failed for profile:', profileId, 'Error:', error.message);
    return {
      success: false,
      data: null,
      error: error.message
    };
  }
}

// Middleware to verify JWT token and check HR role
function verifyHRToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ ok: false, error: 'Authorization header with Bearer token is required' });
    }

    const token = authHeader.split(' ')[1];
    const secret = process.env.JWT_SECRET || 'dev-secret';
    
    const decoded = jwt.verify(token, secret);
    
    // Check if user role is HR
    if (decoded.role !== 'hr') {
      return res.status(403).json({ ok: false, error: 'Access denied. HR role required.' });
    }

    // Add user info to request
    req.user = {
      user_id: decoded.user_id,
      email: decoded.email,
      role: decoded.role
    };

    next();
  } catch (error) {
    return res.status(401).json({ ok: false, error: 'Invalid or expired token' });
  }
}

// POST /upload-job-description
async function uploadJobDescription(req, res) {
  try {
    console.log('Starting upload process...');
    console.log('AWS Region:', process.env.AWS_REGION);
    console.log('AWS Access Key ID:', process.env.AWS_ACCESS_KEY_ID ? 'Set' : 'Not set');
    console.log('AWS Secret Access Key:', process.env.AWS_SECRET_ACCESS_KEY ? 'Set' : 'Not set');
    
    // Use multer middleware to handle file upload
    upload.single('pdfFile')(req, res, async function (err) {
      if (err) {
        console.error('Upload error:', err);
        if (err.message === 'Only PDF files are allowed') {
          return res.status(400).json({ ok: false, error: 'Only PDF files are allowed' });
        }
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ ok: false, error: 'File size too large. Maximum 10MB allowed.' });
        }
        return res.status(400).json({ ok: false, error: err.message });
      }

      // Check if file was uploaded
      if (!req.file) {
        return res.status(400).json({ ok: false, error: 'PDF file is required' });
      }

      // Get form data
      const { title, department } = req.body;
      
      // Validate required fields
      if (!title || !department) {
        return res.status(400).json({ ok: false, error: 'Title and department are required' });
      }

      const nowIso = moment.utc().toISOString();
      const jdId = uuidv4();

      // Use original filename with jd/ prefix
      const filename = `jd/${req.file.originalname}`;

      console.log('Uploading file to S3:', filename);

      try {
        // Upload file to S3
        const s3Uri = await uploadToS3(req.file, filename);
        console.log('File uploaded to S3 successfully:', s3Uri);

        console.log('Creating database record...');

        // Build job description item
        const jdItem = jobDescriptionModel.buildItem({
          id: jdId,
          created_at: nowIso,
          created_by: req.user.user_id,
          hr_id: req.user.user_id,
          jd_department: department,
          jd_title: title,
          jd_url: s3Uri,
          status: 1,
          updated_at: nowIso,
          updated_by: req.user.user_id
        });

        // Save to DynamoDB
        console.log('Saving to DynamoDB table:', jobDescriptionModel.tableName);
        await Dynamo.put({ 
          TableName: jobDescriptionModel.tableName, 
          Item: jdItem 
        }).promise();

        console.log('Database record created successfully');

        return res.status(201).json({
          ok: true,
          message: 'Job description uploaded successfully',
          data: {
            id: jdId,
            title: title,
            department: department,
            jd_url: s3Uri,
            uploaded_at: nowIso
          }
        });

      } catch (s3Error) {
        console.error('S3 upload error:', s3Error);
        return res.status(500).json({ 
          ok: false, 
          error: 'Failed to upload file to S3', 
          message: s3Error.message 
        });
      }
    });
  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({ ok: false, error: 'Internal server error', message: error.message });
  }
}

// PUT /close-job-description
async function closeJobDescription(req, res) {
  try {
    const { jd_id } = req.body;
    
    // Validate required fields
    if (!jd_id) {
      return res.status(400).json({ ok: false, error: 'jd_id is required' });
    }

    const nowIso = moment.utc().toISOString();

    console.log('Closing job description:', jd_id);

    // Update the job description status to 0 (closed)
    const updateParams = {
      TableName: jobDescriptionModel.tableName,
      Key: {
        id: jd_id
      },
      UpdateExpression: 'SET #status = :status, updated_at = :updated_at, updated_by = :updated_by',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': 0,
        ':updated_at': nowIso,
        ':updated_by': req.user.user_id
      },
      ReturnValues: 'ALL_NEW'
    };

    const result = await Dynamo.update(updateParams).promise();

    console.log('Job description closed successfully');

    return res.status(200).json({
      ok: true,
      message: 'Job description closed successfully',
      data: {
        id: jd_id,
        status: 0,
        updated_at: nowIso,
        updated_by: req.user.user_id
      }
    });

  } catch (error) {
    console.error('Close job description error:', error);
    
    // Handle specific DynamoDB errors
    if (error.code === 'ConditionalCheckFailedException') {
      return res.status(404).json({ 
        ok: false, 
        error: 'Job description not found or already closed' 
      });
    }
    
    return res.status(500).json({ 
      ok: false, 
      error: 'Internal server error', 
      message: error.message 
    });
  }
}

// GET /jd-list - List job descriptions for the authenticated HR user
async function jdList(req, res) {
  try {
    const hrId = req.user.user_id;
    
    console.log('Fetching job descriptions for HR:', hrId);

    // Query DynamoDB to get job descriptions for this HR user
    const params = {
      TableName: jobDescriptionModel.tableName,
      FilterExpression: 'hr_id = :hr_id',
      ExpressionAttributeValues: {
        ':hr_id': hrId
      }
    };

    const result = await Dynamo.scan(params).promise();
    const jobDescriptions = result.Items || [];

    console.log(`Found ${jobDescriptions.length} job descriptions for HR ${hrId}`);

    // Format the response data
    const formattedJDs = jobDescriptions.map(jd => ({
      id: jd.id,
      title: jd.jd_title,
      department: jd.jd_department,
      jd_url: jd.jd_url,
      status: jd.status,
      created_at: jd.created_at,
      updated_at: jd.updated_at,
      created_by: jd.created_by,
      updated_by: jd.updated_by
    }));

    return res.status(200).json({
      ok: true,
      message: 'Job descriptions retrieved successfully',
      data: {
        hr_id: hrId,
        total_count: jobDescriptions.length,
        job_descriptions: formattedJDs
      }
    });

  } catch (error) {
    console.error('JD List error:', error);
    return res.status(500).json({ 
      ok: false, 
      error: 'Internal server error', 
      message: error.message 
    });
  }
}

// POST /upload-bulk-resumes - Upload multiple resumes for a job description
async function uploadBulkResumes(req, res) {
  try {
    console.log('Starting bulk resume upload process...');
    
    // Use multer middleware to handle multiple file uploads
    uploadBulkResumesMiddleware.array('resumes')(req, res, async function (err) {
      if (err) {
        console.error('Upload error:', err);
        if (err.message.includes('Only PDF files are allowed')) {
          return res.status(400).json({ ok: false, error: 'Only PDF files are allowed for resumes' });
        }
        return res.status(400).json({ ok: false, error: err.message });
      }

      // Check if files were uploaded
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ ok: false, error: 'At least one resume file is required' });
      }

    // Get form data
    const { jd_id } = req.body;
    
    // Validate required fields
    if (!jd_id) {
      return res.status(400).json({ ok: false, error: 'jd_id is required' });
    }

    const hrId = req.user.user_id;
    const nowIso = moment.utc().toISOString();
    const uploadedResumes = [];
    const errors = [];
    const aiAnalysisResults = [];

    console.log(`Uploading ${req.files.length} resumes for JD: ${jd_id}`);

    // Get job description details for AI analysis
    let jdDetails = null;
    try {
      jdDetails = await getJobDescriptionDetails(jd_id);
      console.log('Job description details fetched successfully');
    } catch (jdError) {
      console.error('Error fetching job description details:', jdError);
      return res.status(500).json({ 
        ok: false, 
        error: 'Failed to fetch job description details', 
        message: jdError.message 
      });
    }

    // Process each file
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      
      try {
        // Use original filename
        const filename = file.originalname;

        console.log(`Uploading resume ${i + 1}/${req.files.length}: ${filename}`);

        // Upload file to S3
        const s3Uri = await uploadResumeToS3(file, filename);
        console.log(`Resume ${i + 1} uploaded to S3 successfully: ${s3Uri}`);

        // Generate unique ID for resume record (this will be used as profile_id)
        const resumeId = uuidv4();

        // Build resume item
        const resumeItem = resumeModel.buildItem({
          id: resumeId,
          created_at: nowIso,
          created_by: hrId,
          hr_id: hrId,
          jd_id: jd_id,
          resume_url: s3Uri,
          status: 1,
          updated_at: nowIso,
          updated_by: hrId
        });

        // Save to DynamoDB
        await Dynamo.put({ 
          TableName: resumeModel.tableName, 
          Item: resumeItem 
        }).promise();

        console.log(`Resume ${i + 1} database record created successfully`);

        // Call AI analysis for this resume
        if (jdDetails && jdDetails.jd_url) {
          console.log(`Starting AI analysis for resume ${i + 1}/${req.files.length}`);
          
          const aiResult = await callAIAnalysis(
            jdDetails.jd_url,  // JD S3 URL
            s3Uri,             // Resume S3 URL
            jd_id,             // Job Description ID
            hrId,              // HR ID
            resumeId           // Profile ID (using resume ID as profile ID)
          );
console.log('aiResult', aiResult)
          aiAnalysisResults.push({
            resume_id: resumeId,
            filename: file.originalname,
            ai_success: aiResult.success,
            ai_error: aiResult.error
          });

          if (aiResult.success) {
            console.log(`AI analysis completed successfully for resume ${i + 1}`);
          } else {
            console.error(`AI analysis failed for resume ${i + 1}:`, aiResult.error);
          }
        } else {
          console.error('Job description URL not found, skipping AI analysis');
          aiAnalysisResults.push({
            resume_id: resumeId,
            filename: file.originalname,
            ai_success: false,
            ai_error: 'Job description URL not found'
          });
        }

        uploadedResumes.push({
          id: resumeId,
          filename: file.originalname,
          resume_url: s3Uri,
          uploaded_at: nowIso
        });

      } catch (fileError) {
        console.error(`Error uploading resume ${i + 1}:`, fileError);
        errors.push({
          filename: file.originalname,
          error: fileError.message
        });
      }
    }

    // Calculate AI analysis statistics
    const successfulAiAnalysis = aiAnalysisResults.filter(result => result.ai_success).length;
    const failedAiAnalysis = aiAnalysisResults.filter(result => !result.ai_success).length;

    // Prepare response
    const response = {
      ok: true,
      message: `Bulk resume upload completed. ${uploadedResumes.length} successful, ${errors.length} failed. AI analysis: ${successfulAiAnalysis} successful, ${failedAiAnalysis} failed.`,
      data: {
        jd_id: jd_id,
        hr_id: hrId,
        total_files: req.files.length,
        successful_uploads: uploadedResumes.length,
        failed_uploads: errors.length,
        ai_analysis: {
          total_resumes: uploadedResumes.length,
          successful_analysis: successfulAiAnalysis,
          failed_analysis: failedAiAnalysis,
          analysis_results: aiAnalysisResults
        },
        uploaded_resumes: uploadedResumes,
        errors: errors.length > 0 ? errors : undefined
      }
    };

    // Return appropriate status code based on results
    if (errors.length === 0) {
      return res.status(201).json(response);
    } else if (uploadedResumes.length > 0) {
      return res.status(207).json(response); // Multi-status (partial success)
    } else {
      return res.status(400).json({
        ok: false,
        error: 'All resume uploads failed',
        data: {
          jd_id: jd_id,
          hr_id: hrId,
          total_files: req.files.length,
          errors: errors
        }
      });
    }
    });
  } catch (error) {
    console.error('Bulk resume upload error:', error);
    return res.status(500).json({ 
      ok: false, 
      error: 'Internal server error', 
      message: error.message 
    });
  }
}

module.exports = {
  uploadJobDescription,
  closeJobDescription,
  jdList,
  uploadBulkResumes,
  verifyHRToken
};