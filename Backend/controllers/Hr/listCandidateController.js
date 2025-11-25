const { Dynamo } = require('../../config/AWS');
const shortlistModel = require('../../models/shortlistModel');
const jwt = require('jsonwebtoken');

/**
 * GET /api/candidates
 * Body: { hrId: string, jdId: string }
 * Headers: Authorization: Bearer <token>
 */
async function getCandidatesByJD(req, res) {
  try {
    // 1. Verify JWT token and get user info
    const authHeader = req.headers?.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
    
    if (!token) {
      return res.status(401).json({ ok: false, error: 'Missing authorization token' });
    }

    // Verify the token
    try {
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
      
    } catch (error) {
      console.error('Token verification failed:', error);
      return res.status(401).json({ ok: false, error: 'Invalid or expired token' });
    }

    // Get HR ID and jdId from the request body
    const { hrId, jdId } = req.body;
    console.log('Received request with hrId:', hrId, 'and jdId:', jdId);

    if (!hrId || !jdId) {
      const missingFields = [];
      if (!hrId) missingFields.push('hrId');
      if (!jdId) missingFields.push('jdId');
      
      console.log('Missing required fields:', missingFields.join(', '));
      return res.status(400).json({ 
        ok: false, 
        error: `Missing required fields: ${missingFields.join(', ')}`,
        required: { hrId: 'string', jdId: 'string' }
      });
    }

    // First, let's check the table structure
    console.log('Table name:', shortlistModel.tableName);
    
    // Query using scan since we need to filter by both jdId and hrId
    const params = {
      TableName: shortlistModel.tableName,
      FilterExpression: '#jdId = :jdId AND #hrId = :hrId',
      ExpressionAttributeNames: {
        '#jdId': 'jd_id',
        '#hrId': 'hr_id'
      },
      ExpressionAttributeValues: {
        ':jdId': jdId,
        ':hrId': hrId
      }
    };
    
    console.log('Debug: Querying records with jdId (partition key):', jdId);

    try {
      console.log('Querying DynamoDB with params:', JSON.stringify(params, null, 2));
      
      // Execute the scan with detailed error handling
      let result;
      try {
        console.log('Executing DynamoDB scan with params:', JSON.stringify(params, null, 2));
        result = await Dynamo.scan(params).promise();
        console.log('DynamoDB scan successful');
      } catch (queryError) {
        console.error('DynamoDB query failed:', {
          error: queryError,
          code: queryError.code,
          message: queryError.message,
          params: JSON.stringify(params, null, 2)
        });
        throw new Error(`Query failed: ${queryError.code} - ${queryError.message}`);
      }
      
      const candidates = result.Items || [];
      
      console.log(`Found ${candidates.length} candidates for jdId: ${jdId}`);
      
      if (candidates.length > 0) {
        console.log('Sample candidate record structure:', JSON.stringify(candidates[0], null, 2));
        
        // Log all hr_ids found for this jdId
        const uniqueHrIds = [...new Set(candidates.map(c => c.hr_id || c.hrId))];
        console.log('All unique hr_ids found for this jdId:', uniqueHrIds);
      } else {
        console.log('No candidates found. Please verify:', {
          tableName: shortlistModel.tableName,
          jdId,
          scanCount: result.ScannedCount || 0,
          query: 'SELECT * FROM ' + shortlistModel.tableName + ' WHERE jd_id = ' + JSON.stringify(jdId)
        });
      }

      // Format the response with all required fields
      const formattedCandidates = candidates
        .map(candidate => {
          // Handle both hr_id and hrId field names
          const candidateHrId = candidate.hr_id || candidate.hrId;
          
          // Only include candidates that match the requested hrId
          if (candidateHrId !== hrId) {
            console.log(`Skipping candidate ${candidate.id} - hrId mismatch: ${candidateHrId} vs ${hrId}`);
            return null;
          }
          
          return {
            id: candidate.id,
            jdId: candidate.jd_id || candidate.jdId,
            profileId: candidate.profile_id || candidate.profileId || null,
            hrId: candidateHrId,
            name: candidate.name || '',
            email: candidate.email || '',
            phone: candidate.phone || '',
            location: candidate.location || '',
            professionalSummary: candidate.professional_summary || candidate.professionalSummary || '',
            documentType: candidate.document_type || candidate.documentType || '',
            analysisScore: candidate.analysis_score || candidate.analysisScore || 0,
            analysisDetails: candidate.analysis_details || candidate.analysisDetails || {},
            recommendation: candidate.recommendation || '',
            sessionId: candidate.session_id || candidate.sessionId || '',
            jdText: candidate.jd_text || candidate.jdText || '',
            skills: Array.isArray(candidate.skills) ? candidate.skills : [],
            jdSkills: Array.isArray(candidate.jd_skills) ? candidate.jd_skills : 
                     Array.isArray(candidate.jdSkills) ? candidate.jdSkills : [],
            education: Array.isArray(candidate.education) ? candidate.education : [],
            workExperience: Array.isArray(candidate.work_experience) ? candidate.work_experience :
                          Array.isArray(candidate.workExperience) ? candidate.workExperience : [],
            projects: Array.isArray(candidate.projects) ? candidate.projects : [],
            certifications: Array.isArray(candidate.certifications) ? candidate.certifications : [],
            profileLinks: Array.isArray(candidate.profile_links) ? candidate.profile_links :
                         Array.isArray(candidate.profileLinks) ? candidate.profileLinks : [],
            createdAt: candidate.created_at || candidate.createdAt || new Date().toISOString(),
            updatedAt: candidate.updated_at || candidate.updatedAt || new Date().toISOString()
          };
        })
        .filter(Boolean); // Remove any null entries (filtered out by hrId)

      return res.status(200).json({
        ok: true,
        data: formattedCandidates,
        count: formattedCandidates.length
      });

    } catch (dbError) {
      console.error('Database query failed:', dbError);
      throw dbError; // This will be caught by the outer catch block
    }

  } catch (error) {
    // Make sure we have the request parameters in scope
    const errorHrId = req.body.hrId || 'not-provided';
    const errorJdId = req.body.jdId || 'not-provided';
    
    console.error('Error in getCandidatesByJD:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code,
      time: new Date().toISOString(),
      params: { 
        hrId: errorHrId,
        jdId: errorJdId 
      },
      requestBody: req.body
    });
    
    return res.status(500).json({ 
      ok: false, 
      error: 'Failed to fetch candidates',
      details: process.env.NODE_ENV === 'development' ? {
        message: error.message,
        code: error.code,
        stack: error.stack
      } : undefined
    });
  }
}

module.exports = {
  getCandidatesByJD
};