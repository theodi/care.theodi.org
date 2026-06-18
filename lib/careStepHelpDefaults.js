/**
 * CARE built-in HTML for the Step guidance modal (human audience).
 * Stage ids match scan form names / pageId values.
 */

const CARE_STEP_HELP_DEFAULTS = {
  projectDetails:
    '<p>Please provide a detailed description of your data project including its general goals and overall purpose. You may wish to include details on the following:</p>' +
    '<ol><li>Explain how data will be used, processed, stored, and protected throughout the project.</li>' +
    '<li>Provide an estimated project timeline, including key milestones, and important deadlines.</li>' +
    '<li>Mention any relevant data privacy regulations, industry standards, or compliance requirements that the project must adhere to.</li>' +
    '<li>Explain how risks will be monitored throughout the project and the process for reporting and addressing them as they occur.</li></ol>' +
    '<p>Please be as specific as possible. If you choose to use the assistant AI then the information you provide here will help identify potential risks and generate potential actions for your data project.</p>' +
    '<h3>What data will you be using?</h3>' +
    '<p>Provide details on the data that is being utilised within the project. You may wish to include details on the following:</p>' +
    '<ul><li>What type of data is being used? (e.g., customer info, sales data, etc.)</li>' +
    '<li>Where you get the data from? (sources and providers)</li>' +
    '<li>How the data looks? (format, quality)</li>' +
    '<li>How much data there is? (volume)</li>' +
    '<li>Whether there is any sensitive or private information in the data?</li>' +
    '<li>How you keep the data secure?</li>' +
    '<li>Who has access to the data? (team members, external parties)</li>' +
    '<li>Any legal or compliance rules you follow?</li>' +
    '<li>How long you keep the data and how you get rid of it when done?</li></ul>',

  intendedConsequences:
    '<p>Start by creating a clear list of intended consequences. These consequences enable your project to remain focused on its objectives and desired outcomes. Intended consequences serve as a guide for project evaluation and success measurement.</p>' +
    '<p>Intended consequences are the positive impacts and benefits you expect to create with your data project. This could include improved decision-making, increased efficiency, cost savings, enhanced customer satisfaction, or any other favourable results.</p>',

  unintendedConsequences:
    '<p>To ensure a comprehensive risk assessment for your data project, you should try to identify any potential unintended consequences that may occur. These unintended consequences can have both positive and negative impacts. Consider the following:</p>' +
    '<ul><li>Positive unintended consequences: Think about unexpected benefits or positive outcomes that might result from your project. For example, improved processes, increased efficiency, or unforeseen uses or users of the product or service.</li>' +
    '<li>Negative unintended consequences: Consider any adverse effects or unexpected problems that might occur. This could involve privacy breaches, data misuse, or potential bias in the data.</li>' +
    '<li>Secondary effects: Think about ripple effects that your project might have on other processes, systems, or stakeholders, even if they are not directly involved.</li>' +
    '<li>External factors: Take into account external factors or events that your project might interact with or influence. These could include changes in regulations, market conditions, or technological advancements.</li></ul>' +
    '<p>Add a brief description of the unintended consequence that may occur during your data project and indicate whether the outcome is positive or negative.</p>',

  stakeholders:
    '<h2>Who are the stakeholders?</h2>' +
    '<p>Please list the names or titles of individuals, teams, or organisations that are <b>involved in</b>, or <b>impacted by</b> your project.</p>' +
    '<p>For each stakeholder, indicate whether they are an "internal" stakeholder (part of your organisation or project team) or an "external" stakeholder (outside the organisation or project team).</p>',

  riskEvaluation:
    '<h2>Evaluate risks of unintended consequences</h2>' +
    '<p>To evaluate the risks associated with your data project, we are going to further examine the unintended consequences.</p>' +
    '<p>For each unintended consequence, please assess both its impact and likelihood on a scale of low, medium, and high. This evaluation will help prioritise and manage risks effectively.</p>',

  actionPlanning:
    '<h2>Assign actions to consequences</h2>' +
    '<p>For each unintended consequence, you will now assign specific actions to mitigate or manage the risk and add a key performance indicator (KPI) to track the effectiveness of each action. You should:</p>' +
    '<ul><li><b>Create the mitigation action</b>: Describe the specific action(s) that need to be taken to mitigate or manage the consequence effectively. Be as detailed as possible, specifying what needs to be done and who is responsible.</li>' +
    '<li><b>Define the key performance indicator (KPI)</b>: Define a KPI that will help measure the success or progress of the mitigation action. The KPI should be a measurable metric that indicates the desired outcome. It could be related to time, cost, performance, or any other relevant measure.</li>' +
    '<li>For each action, you should also assign an estimated timescale (3 months, 6 months, 1 year, etc).</li></ul>',

  actionCompletion:
    '<h2>Record action completion</h2>' +
    '<p>Review each planned mitigation action and record whether it has been completed. Where an action is completed, add a short comment describing what was done, any outcome, or anything worth noting for future review.</p>',
};

function getCareStepHelpDefault(stepId) {
  const id = String(stepId || '').trim();
  return CARE_STEP_HELP_DEFAULTS[id] || '';
}

function getCareHumanTemplatesMap() {
  return { ...CARE_STEP_HELP_DEFAULTS };
}

module.exports = {
  CARE_STEP_HELP_DEFAULTS,
  getCareStepHelpDefault,
  getCareHumanTemplatesMap,
};
