const path = require('path');
const fs = require('fs');

// Load environment variables securely
require("dotenv").config({ path: "./config.env" });
const { checkLimit } = require('./middleware/hubspot');
const { getAiPrivacyDisclosure } = require('./services/aiPrivacyDisclosure');

// MongoDB setup
const mongoose = require('mongoose');

// Read MongoDB URI and database name from environment variables
const mongoURI = process.env.MONGO_URI;
const mongoDB = process.env.MONGO_DB;

// Connect to MongoDB
mongoose.connect(mongoURI, { dbName: mongoDB }).catch((err) => {
  console.error('MongoDB initial connection failed:', err);
});

const db = mongoose.connection;

// Check MongoDB connection
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', function() {
  console.log("Connected to MongoDB database");
});

// Set up App

const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const passport = require('./passport'); // Require the passport module
const authRoutes = require('./routes/auth'); // Require the authentication routes module
const subscriptionRoutes = require('./routes/subscriptions');
const organisationRoutes = require('./routes/organisation');
const projectRoutes = require('./routes/project'); // Require the project routes module
const { isCareStaffEmail } = require('./middleware/careStaff');
const { userHasActiveOrgEntitlementByEmail, getUserOrganisationMetaByEmail } = require('./lib/organisationEntitlements');
const { formatApiError } = require('./lib/formatApiError');
const assistantRoutes = require('./routes/assistant'); // Require the project routes module
const { loadProject } = require('./middleware/project');
const { deleteUser, retrieveOrCreateUser } = require('./controllers/user'); // Import necessary functions from controllers
const { getHubspotProfile, updateToolStatistics } = require('./controllers/hubspot');
const app = express();
const port = process.env.PORT || 3080;
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) {
  app.set('trust proxy', 1);
}
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
const expressLayouts = require('express-ejs-layouts');
app.use(expressLayouts);
app.set('layout', 'layout');

app.use(function(req, res, next) {
  res.locals.layoutScanHeader = false;
  next();
});

// Middleware for logging
const logger = require('morgan');
//app.use(logger('dev'));

// Middleware for parsing incoming requests
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Other middleware and setup code...

// Session configuration — MongoDB store so restarts do not clear logins (see collection `sessions`)
const mongoSessionStoreOpts = { mongoUrl: mongoURI };
if (mongoDB) {
  mongoSessionStoreOpts.dbName = mongoDB;
}
app.use(session({
  resave: false,
  saveUninitialized: false,
  secret: process.env.SESSION_SECRET,
  store: MongoStore.create(mongoSessionStoreOpts),
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 12,
  },
}));

function sameOrigin(urlString, req) {
  if (!urlString) return false;
  try {
    const parsed = new URL(urlString);
    const forwardedProto = req.get('x-forwarded-proto');
    const proto = forwardedProto || req.protocol;
    const expectedOrigin = `${proto}://${req.get('host')}`;
    return parsed.origin === expectedOrigin;
  } catch {
    return false;
  }
}

app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
  const origin = req.get('Origin');
  const referer = req.get('Referer');
  const valid = sameOrigin(origin, req) || sameOrigin(referer, req);
  if (valid) {
    return next();
  }
  const err = new Error('Cross-site request blocked');
  err.status = 403;
  return next(err);
});

// Middleware for user object

// Initialize Passport.js
app.use(passport.initialize());
app.use(passport.session());

app.use(function(req, res, next) {
  res.locals.user = req.session.passport ? req.session.passport.user : req.session.user;
  next();
});

app.use(async function(req, res, next) {
  const u = res.locals.user;
  res.locals.isCareStaff = isCareStaffEmail(u && u.email);
  if (u && u.id && req.isAuthenticated()) {
    try {
      res.locals.hasOrganisationMembership = await userHasActiveOrgEntitlementByEmail(u.email);
    } catch (e) {
      res.locals.hasOrganisationMembership = false;
    }
  } else {
    res.locals.hasOrganisationMembership = false;
  }
  next();
});

app.use((req, res, next) => {
  // Read package.json file
  fs.readFile(path.join(__dirname, 'package.json'), 'utf8', (err, data) => {
      if (err) {
          console.error('Error reading package.json:', err);
          return next();
      }

      try {
          const packageJson = JSON.parse(data);
          // Extract version from package.json
          var software = {};
          software.version = packageJson.version;
          software.homepage = packageJson.homepage;
          software.versionLink = packageJson.homepage + "/releases/tag/v" + packageJson.version;
          res.locals.software = software;
      } catch (error) {
          console.error('Error parsing package.json:', error);
      }

      next();
  });
});

// Logout route
app.post('/logout', function(req, res, next){
  req.logout(function(err) {
    if (err) { return next(err); }
    res.redirect('/');
  });
});

// Middleware to ensure authentication
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated())
    return next();
  else
    unauthorised(res);
}

function unauthorised(res) {
  const page = {
    title: "Error"
  };
  res.locals.page = page;
  const error = new Error("Unauthorized access");
  error.status = 401;
  throw error;
}

// Routes

app.get('/docs/tenant-integration', (req, res) => {
  res.redirect(301, '/docs/tenant-integration.html');
});

app.get('/docs/report-template', (req, res) => {
  res.redirect(301, '/docs/report-template.html');
});

app.use(express.static(__dirname + '/public')); // Public directory

// Use authentication routes
app.use('/auth', authRoutes);

app.get('/admin', function(req,res) {
  res.redirect('/auth/google');
});

app.use('/subscriptions', subscriptionRoutes);
app.use('/organisation', organisationRoutes);

app.use(loadProject);

app.use('/project', projectRoutes);

app.use('/assistant', assistantRoutes);

app.get('/', function(req, res) {
  const page = {
    title: "Consequence and Risk Evaluation (CARE)",
    link: "/"
  };
  res.locals.page = page;
  res.render('pages/home');
});

app.get('/new', ensureAuthenticated, checkLimit, function(req, res, next) {
  // Always start a brand-new evaluation from /new (no existing id in session).
  delete req.session.projectId;
  res.locals.project = undefined;
  const page = {
    title: "Project details",
    link: "projectDetails"
  };
  res.locals.page = page;
  res.locals.layoutScanHeader = true;
  // New evaluations do not have an id yet; render scan page without sidebar context.
  res.render('pages/scan');
});

app.get('/examples', ensureAuthenticated, function(req, res) {
  const page = {
    title: "Example case studies",
    link: "/new"
  };
  res.locals.page = page;
  res.render('pages/examples');
});

app.get('/about', function(req, res) {
  const page = {
    title: "About",
    link: "/about"
  };
  res.locals.page = page;
  res.locals.aiPrivacy = getAiPrivacyDisclosure();
  res.render('pages/about', { layout: false });
});

app.get('/glossary', function(req, res) {
    // Check the Accept header
    const acceptHeader = req.get('Accept');

    // If accept header is application/json, send the glossary.json file
    if (acceptHeader === 'application/json') {
        // Read the glossary.json file
        fs.readFile('public/data/glossary.json', 'utf8', (err, data) => {
            if (err) {
                res.status(500).json({ error: 'Internal Server Error' });
            } else {
                try {
                    res.json(JSON.parse(data));
                } catch {
                    res.status(500).json({ error: 'Invalid glossary data' });
                }
            }
        });
    } else {
        // Otherwise, render the EJS page for glossary and pass the glossary data
        fs.readFile('public/data/glossary.json', 'utf8', (err, data) => {
            if (err) {
                res.status(500).send('Internal Server Error');
            } else {
                let glossaryData;
                try {
                    glossaryData = JSON.parse(data);
                } catch {
                    return res.status(500).send('Internal Server Error');
                }
                const page = {
                  title: "Glossary",
                  link: "/glossary"
                };
                res.locals.page = page;
                res.render('pages/glossary', { data: glossaryData, layout: false });
            }
        });
    }
});

app.get('/profile', ensureAuthenticated, async (req, res, next) => {
  try {
    res.locals.userProfile = await retrieveOrCreateUser(res.locals.user);
    res.locals.userProfile.hubspot = await getHubspotProfile(res.locals.userProfile.id);
    res.locals.careOrganisationMembership = await getUserOrganisationMetaByEmail(
      res.locals.userProfile.email
    );
    const page = {
      title: "Profile page",
      link: "/profile"
    };
    res.locals.page = page;
    res.render('pages/profile');
  } catch (error) {
    next(error);
  }
});

app.delete('/profile', ensureAuthenticated, async (req, res, next) => {
  try {
      // Get the user ID from the authenticated user
      const userId = req.session.passport.user.id;

      // Check if the user has any projects
      const userProjects = await projectController.getUserProjects(userId);
      const ownedProjects = userProjects.ownedProjects.projects;

      if (ownedProjects.length === 0) {
          // If the user has no projects, delete the user
          await deleteUser(userId)
          res.status(200).json({ message: "User deleted successfully." });
      } else {
          // If the user has projects, send a message indicating deletion is not allowed
          res.status(403).json({ error: "User cannot be deleted because they have projects. Please delete all owned projects first." });
      }
  } catch (error) {
      next(error);
  }
});


const projectController = require('./controllers/project');

app.get('/projects', ensureAuthenticated, async (req, res, next) => {
    try {
        // Check if the request accepts JSON
        const acceptHeader = req.get('Accept');
        const userId = req.session.passport.user.id;
        if (acceptHeader === 'application/json') {
            // Fetch user projects and send JSON response
            const userProjects = await projectController.getUserProjects(userId);
            const userEmail = req.session.passport.user.email;
            const organisationMeta = await getUserOrganisationMetaByEmail(userEmail);
            res.json({ ...userProjects, organisationMeta });
        } else {
            updateToolStatistics(req.session.passport.user.id);
            const page = {
              title: "Dashboard",
              link: "/projects"
            };
            res.locals.page = page;
            res.render('pages/projects');
        }
    } catch (error) {
      next(error);
    }
});

app.get('/evaluations', ensureAuthenticated, async (req, res, next) => {
    try {
        const page = {
            title: 'Evaluations',
            link: '/evaluations',
        };
        res.locals.page = page;
        res.render('pages/evaluations');
    } catch (error) {
        next(error);
    }
});

app.get('/schemas/:schema(*)', ensureAuthenticated, async (req, res, next) => {
  try {
      const schemaPath = req.params.schema;
      const fullPath = path.join(__dirname, 'public/data/schemas', schemaPath);
      if (fs.existsSync(fullPath)) {
          var schema = require(fullPath);

          /*
           * Hack to update the schema with defined data
           */
          if (
            (schemaPath === "partials/actionPlanning.json" || schemaPath === "partials/actionCompletion.json") &&
            res.locals.project &&
            res.locals.project.stakeholders
          ) {
            const stakeholders = res.locals.project.stakeholders.map(stakeholder => stakeholder.stakeholder);
            // Update the enum for action.stakeholder in the schema
            const properties = schema.properties;
            if (properties.unintendedConsequences && properties.unintendedConsequences.items) {
                const actionSchema = properties.unintendedConsequences.items.properties.action;
                if (actionSchema && actionSchema.properties && actionSchema.properties.stakeholder) {
                    actionSchema.properties.stakeholder.enum = stakeholders;
                }
            }
          }


          return res.json(schema);
      } else {
          return res.status(404).json({ error: 'Schema not found' });
      }
  } catch (error) {
      next(error);
  }
});

// Error handling
app.get('/error', (req, res) => res.send("error logging in"));

app.get('*', function(req, res, next){
  const page = {
    title: "404 Not Found"
  };
  res.locals.page = page;
  const error = new Error("Not Found");
  error.status = 404;
  next(error);
});

// Error handling middleware
app.use((err, req, res, next) => {
  const { statusCode, body } = formatApiError(err);
  if (statusCode >= 500) {
    console.error('[http error]', req.method, req.originalUrl, err.message);
    if (err.stack) console.error(err.stack);
  }
  const page = {
    title: "Error"
  };
  res.locals.page = page;

  const acceptHeader = req.get('Accept') || '';
  const wantsJson = acceptHeader.includes('application/json');

  if (wantsJson) {
    return res.status(statusCode).json(body);
  }
  const errorMessage =
    typeof body.message === 'string' ? body.message : 'Internal Server Error';
  return res.status(statusCode).render('errors/error', { statusCode, errorMessage });
});

// Start server
app.listen(port , () => console.log('App listening on port ' + port));