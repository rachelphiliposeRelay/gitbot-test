import email_mapping from './githubUserEmailMap.json' with { type: "json" };
import axios  from 'axios';
import moment  from 'moment';
import {Octokit} from '@octokit/rest';
import {App} from 'octokit';
import dotenv from 'dotenv';

const TRACKED_REPOSITORY = "gitbot-test"
const REPOSITORY_OWNER = "rachelphiliposeRelay"

console.log("Outside the module");


console.log("Inside the module!!");
dotenv.config();

console.log(process.env.APP_ID)
const app_auth = new App({
    appId: process.env.APP_ID,
    privateKey: process.env.PRIVATE_KEY,
});

async function getEmailFromGitHub(gh_username) {

const octokit = await app_auth.getInstallationOctokit(48217668);

const res = await octokit.request(`/users/${gh_username}`);

if (res.data.email && res.data.email.slice(-12,) == "@relayfi.com") {
    return res.data.email; 
}

else {

    try {
    return email_mapping[gh_username]["relayEmail"];
    }catch {
    return false;
    }

}
}

async function getSlackID(email) {
if (!email) {
    return false;
}

const headers = {
    'Content-type': 'application/json',
    'Authorization' : `Bearer ${process.env.SLACK_TOKEN} `,
    "type": "url_verification"
}

const user = await axios.get(`https://slack.com/api/users.lookupByEmail?email=${email}`, {
    "headers": headers,
});

return user.data.user.id ? user.data.user.id : false;
}

async function createSlackChannelMessage(data) {
const slackWebhookURL = "https://hooks.slack.com/services/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"

try {
    const gh_email = await getEmailFromGitHub(data.user.login);
    var slack_user_id = await getSlackID(gh_email);

} catch(e) {
    console.log(e);
    var slack_user_id = false;
}

const slack_mention = slack_user_id ? slack_user_id : data.user.login;

const pr_link = `<${data.html_url}|PR ${data.number}>` // hyperlinks url to text eg: "PR 123"
//const text = `${pr_link} by <@${slack_mention}> needs to be merged from ${data.head.ref} -> ${data.base.ref} `
const text = `${pr_link} by <@${slack_mention}> needs to be merged from` + "`" + `${data.head.ref} -> ${data.base.ref}` + "`.\n"

return text;

};

async function sendSlackDM(data) {

try {
    const gh_email = await getEmailFromGitHub(data.user.login);
    var slack_user_id = await getSlackID(gh_email);
} catch {
    var slack_user_id = false;
}

const slack_mention = slack_user_id ? slack_user_id : data.user.login;

const pr_link = `<${data.html_url}|PR ${data.number}>` // hyperlinks url to text eg: "PR 123"
const text = `Hey <@${slack_mention}>! You have a pull request, ${pr_link} that needs to be merged from ` + "`" + `${data.head.ref} -> ${data.base.ref}` + "`.";

const headers = {
    'Authorization': `Bearer ${process.env.SLACK_TOKEN}`,
    'Content-type': 'application/x-www-form-urlencoded',
}

const res = await axios.post('https://slack.com/api/chat.postMessage', 
{
    "text": text,
    "channel": slack_mention
},
{
    headers:headers
});

};


async function sendReminders() {

const octokit = await app_auth.getInstallationOctokit(48217668);

const slackWebhookURL = "https://hooks.slack.com/services/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"


let slack_digest = "This is your weekly digest of stale PR's in the `relay-platform` repository. \n";

octokit
.paginate(octokit.rest.issues.listForRepo, {
    owner: REPOSITORY_OWNER,
    repo: TRACKED_REPOSITORY,
})
.then (
    async (issues) => {

    for (const issue of issues) {
        if (issue.pull_request) {

        // calculate time since last edit
        const now = moment(new Date().toJSON().slice(0, 10));
        const latest_edit = issue.updated_at.slice(0, 10);
        const duration = moment.duration(now.diff(latest_edit));
        const weeks = duration.asWeeks();

        if (weeks >= 1 && moment().format('dddd') == 'Friday') { //define the desired staleness of a PR before sending reminders 
            const { data } = await octokit.rest.pulls.get({
            owner: REPOSITORY_OWNER,
            repo: TRACKED_REPOSITORY,
            pull_number: issue.number,
            });

            await sendSlackDM(data);
            
            if (weeks >= 2) {
            const res = await createSlackChannelMessage(data);
            slack_digest +=  res;
            }

        };

        };
    };

    if (moment().format('dddd') == 'Monday') {
        await axios.post(slackWebhookURL, {
        "text": slack_digest,
        });
    }
});

}

sendReminders();
