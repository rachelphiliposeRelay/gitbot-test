import axios  from 'axios';
import moment  from 'moment';
import {App} from 'octokit';
const email_mapping = {"rachelphiliposeRelay": {
    "fullName": "Rachel Philipose",
    "profileStatus": "Active",
    "relayEmail": "rachel.philipose@relayfi.com"
  }};

const TRACKED_REPOSITORY = String(process.env.REPO_INFO).split("/")[1]
const REPOSITORY_OWNER = String(process.env.REPO_INFO).split("/")[0]

const app_id = process.env.APP_ID
const installation_id = process.env.INSTALLATION_ID
const slack_token_secret = process.env.SLACK_TOKEN
const private_key_secret = process.env.PRIVATE_KEY
const slack_channel_id = process.env.SLACK_CHANNEL_ID

const app_auth = new App({
    appId: app_id,
    privateKey: private_key_secret,
});

async function getEmailFromGitHub(gh_username) {

    const octokit = await app_auth.getInstallationOctokit(installation_id);

    const res = await octokit.request(`/users/${gh_username}`);

    if (res.data.email && res.data.email.slice(-12,) == "@relayfi.com") {
        return res.data.email; 
    }

    else {
        try {
        return email_mapping[gh_username]["relayEmail"];
        } catch {
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
        'Authorization' : `Bearer ${slack_token_secret} `,
        "type": "url_verification"
    }

    const user = await axios.get(`https://slack.com/api/users.lookupByEmail?email=${email}`, {
        "headers": headers,
    });

    return user.data.user.id ? user.data.user.id : false;
}

async function createSlackChannelMessage(data) {

    try {
        const gh_email = await getEmailFromGitHub(data.user.login);
        var slack_user_id = await getSlackID(gh_email);

    } catch(e) {
        console.log(e);
        var slack_user_id = false;
    }

    const slack_mention = slack_user_id ? slack_user_id : data.user.login;

    const pr_link = `<${data.html_url}|PR ${data.number}>` // hyperlinks url to text eg: "PR 123"
    const text = `${pr_link} by <@${slack_mention}> needs to be merged from ` + "`" + `${data.head.ref} -> ${data.base.ref}` + "`.\n"

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
    const text = `Hey <@${slack_mention}>! You have a pull request, ${pr_link} in ` + "`"+ `${TRACKED_REPOSITORY}` + "`" +` waiting to be merged from ` + "`" + `${data.head.ref} -> ${data.base.ref}` + "`.";

    const headers = {
        'Authorization': `Bearer ${slack_token_secret}`,
        'Content-type': 'application/x-www-form-urlencoded',
    }

    //if PR created by former employee, DM should error but script continues gracefully
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

    const octokit = await app_auth.getInstallationOctokit(installation_id);

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

                if (weeks >= 1) { //define the desired staleness of a PR before sending reminders 
                    const { data } = await octokit.rest.pulls.get({
                    owner: REPOSITORY_OWNER,
                    repo: TRACKED_REPOSITORY,
                    pull_number: issue.number,
                    });

                    if (moment().format('dddd') == 'Tuesday') {
                        await sendSlackDM(data);
                    }
                    
                    if (weeks >= 2) {
                        const res = await createSlackChannelMessage(data);
                        slack_digest +=  res;
                    }
                };
            };
        };

        if (moment().format('dddd') == 'Thursday') {
            const headers = {
                'Authorization': `Bearer ${slack_token_secret}`,
                'Content-type': 'application/x-www-form-urlencoded',
            }
            
            await axios.post('https://slack.com/api/chat.postMessage', 
            {
                "text": slack_digest,
                "channel": slack_channel_id
            },
            {
                headers:headers
            });
        }
    });

}

sendReminders();