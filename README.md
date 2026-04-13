# Inline Agentforce Chat — Accelerator Package

Deploy an inline Agentforce chat experience — similar to [help.salesforce.com](https://help.salesforce.com) — on your own Experience Cloud site or third-party website. This package gives Salesforce customers and partners a ready-to-use starting point: UI components, a third-party embed script, and a pre-configured Agentforce agent, so you can go from zero to a working inline chat in minutes instead of hours.

---

## Table of Contents

- [Naming Convention](#naming-convention)
- [What's Included](#whats-included)
- [Requirements](#requirements)
- [Installation](#installation)
- [Setup Steps](#setup-steps)
  - [Step 1 — Set Up the Help Agent](#step-1--set-up-the-help-agent)
  - [Step 2 — Create a Messaging Channel](#step-2--create-a-messaging-channel)
  - [Step 3 — Create an Embedded Service Deployment](#step-3--create-an-embedded-service-deployment)
  - [Step 4a — Add to an Experience Cloud Site](#step-4a--add-to-an-experience-cloud-site)
  - [Step 4b — Embed on a Third-Party Website](#step-4b--embed-on-a-third-party-website)
- [Customization](#customization)
- [Troubleshooting](#troubleshooting)
- [Documentation](#documentation)

---

## Naming Convention

All metadata in this package is prefixed with `haa` (**H**elp **A**gent **A**ccelerator) to avoid name collisions in customer orgs. Custom labels use `HAA_` with underscores per Salesforce label naming conventions.

---

## What's included

| Component | Type | Description |
|-----------|------|-------------|
| `haaInlineEnhancedChat` | LWC | Primary inline chat component with prompt bar, state machine, canned prompts, and skeleton loading |
| `haaSkeletonLoader` | LWC | Animated placeholder rows shown during loading |
| `haaInlineEnhancedChat` | Static Resource (JS) | Standalone script to embed inline chat on any third-party website — no build step required |
| Custom Labels | 18 labels (`HAA_*`) | All UI text, error messages, and canned prompt strings — fully customizable |
| `haaHelpAgent` | AI Authoring Bundle | *(Optional)* Pre-configured Agentforce agent with RAG-based knowledge search, general FAQ topic, escalation handling, and off-topic redirection. Requires Knowledge articles and Data Cloud setup |

---

## Requirements

### All deployments

| Requirement | Notes |
|-------------|-------|
| **Enhanced Chat v2** | Requires an Embedded Service Deployment (see [Step 3](#step-3--create-an-embedded-service-deployment)). Contact your Salesforce account team to confirm your org's edition and licenses support this feature |

### By deployment path

| Requirement | LWC path | Third-party JS path |
|-------------|----------|---------------------|
| **Experience Cloud** | Required — hosts the site where the LWC is deployed | Not needed |
| **A website you control** | Not needed | Required — you add a `<script>` tag to your page |

### If using the included Agentforce agent

The package includes an optional pre-configured agent (`haaHelpAgent`). If you use it, you also need:

| Requirement | Notes |
|-------------|-------|
| **Agentforce** | Agent runtime, studio, and topics. Usage billed via Flex Credits |
| **Data Cloud** | Powers the Agentforce Data Library and search index for Knowledge |
| **Knowledge** | Feature within Service Cloud. The agent searches Knowledge articles to answer questions |

---

## Installation

### Source deploy via Salesforce CLI

```bash
git clone <this-repo>
cd help-agent-accelerator
sf project deploy start --manifest manifest/package.xml --target-org YOUR_ORG_ALIAS
```

---

## Setup steps

After installing the package, complete these steps to wire everything together.

### Step 1 — Set Up the Help Agent

The package includes a pre-configured Agentforce agent (`haaHelpAgent`) that answers customer questions using knowledge articles. Follow the instructions below to configure it.

> **Note:** Setting up Data Cloud can take a very long time (30+ minutes to hours). Start this process early or do it ahead of time.

> **Important:** The Help Agent requires Knowledge articles to function. You must create Knowledge articles in your org with appropriate content fields before setting up the agent. The agent searches these articles to answer questions.

#### Prerequisites

Your org must have these features enabled:

**Required for the agent:**
- Data Cloud (for Agentforce Data Library)
- Einstein (for generative AI capabilities)
- Agentforce Agents
- Knowledge articles with relevant content

**Optional for monitoring (recommended):**
- Einstein Audit and Feedback
- Knowledge/RAG Quality Data and Metrics
- Agent Analytics
- Agentforce Session Tracing

#### 1.1. Enable Required Org Features

**Enable Data Cloud:**
1. Go to **Setup → Data Cloud Setup Home**
2. Click **Get Started** and follow the manual setup process
3. **Wait for setup to complete** — this can take 30 minutes to several hours
4. Assign **Data Cloud Architect** permission set to your user

**Enable Einstein:**
1. Go to **Setup → Einstein Setup**
2. Toggle **Einstein** on
3. **Refresh the page** — the Agentforce setup option may not appear until the page is reloaded

**Enable Agentforce:**
1. Go to **Setup → Agentforce Agents**
2. Toggle **Agentforce** on at the top

**Enable Audit and Feedback (optional but recommended):**
1. Go to **Setup → Einstein Generative AI** (use Quick Find)
2. Select **Einstein Audit, Analytics, and Monitoring Setup**
3. Toggle on:
   - Audit and Feedback
   - Knowledge/RAG Quality Data and Metrics
   - Agent Analytics
   - Agentforce Session Tracing

#### 1.2. Create Knowledge Articles

The Help Agent searches Knowledge articles to answer questions. Create Knowledge articles in your org with:
- **Title** — Article headline
- **Summary** — Brief description
- **Content field** — The detailed answer content (can be any rich text field)

Note the API name of your content field — you'll need it in the next step.

#### 1.3. Create an Agentforce Data Library

1. Go to **Setup → Agentforce Data Library**
2. Click **New Library**
3. Configure the library:
   - **Name:** `Help Agent Knowledge`
   - **API Name:** `Help_Agent_Knowledge`
4. Click **Save**
5. Under **Add Data Sources**, configure:
   - **Data Type:** Knowledge
   - **Identifying Field 1:** Title
   - **Identifying Field 2:** Summary
   - **Content Fields:** Select your Knowledge article content field (e.g., `Details__c`, `FAQ_Answer__c`, or whatever field contains your answer content)
6. Click **Save**
7. **Wait for the search index to build** — this creates a Search Index and Retriever in Data Cloud and may take several minutes

#### 1.4. Configure the Agent

1. Go to **App Launcher → Agentforce Studio → Agents**
2. Find and open **HAA Help Agent**
3. Under **Settings → Agent Details**, click **Agent's User Record** and create a new user for this agent:
   - Set appropriate user details (email, username, etc.)
   - Save the user
4. Under **Data → Data Library**, select the **Help Agent Knowledge** ADL you created
5. Click **Save** at the top of the agent editor

#### 1.5. Configure Knowledge Access Permissions

The agent's user needs permission to access Knowledge articles:

1. Go to **Setup → Permission Sets**
2. Find **Agentforce Agent haaHelpAgent Permissions** (auto-created when you deployed the agent)
3. Configure Knowledge access:
   
   **Data Category Visibility:**
   - Click **Edit** next to each category group
   - Select appropriate visibility settings for the data categories containing your Knowledge articles
   
   **Object Settings:**
   - Click **Knowledge (Knowledge__kav)**
   - Ensure the permission set includes:
     - Read access to the object
     - Read access to all relevant fields (Title, Summary, your content field)
   
   **App Permissions:**
   - Select **Allow View Knowledge**

4. Click **Save**

#### 1.6. Test and Activate

1. Return to **Agentforce Studio → Agents → HAA Help Agent**
2. Test the agent using the preview pane:
   - Ask a question that should be answered by your Knowledge articles
   - Verify the agent retrieves and uses the correct information
3. Once satisfied, click **Commit** to save the current version
4. Click **Activate** to make the agent live

The agent is now ready to use in your messaging channel (created in Step 2 below).

---

### Step 2 — Create a Messaging Channel

1. Go to **Setup → Messaging Settings**
2. Under **Channels**, click **New Channel**
3. Click **Start**, then choose **Enhanced Chat**
4. Fill in the channel details:
   - **Channel Name** — e.g. "Inline Agentforce Chat"
   - **Developer Name** — auto-populated from Channel Name
5. Complete the remaining wizard steps
6. Under **Routing**, link the channel to the **HAA Help Agent** from Step 1
7. Click **Save**
8. On the channel detail page, click **Activate** to enable the channel

### Step 3 — Create an Embedded Service Deployment

1. Go to **Setup → Embedded Service Deployments**
2. Select the deployment with the channel name from Step 2
3. Click **Switch to V2**
4. Click **Switch & Publish** in the modal window
5. Open the **Code Snippet** tab and note the following values — you'll need them in the next steps:

| Value | Where to find it |
|-------|-------------------|
| **Org ID** | First parameter of the `init()` call (18 characters) |
| **Deployment API Name** | Second parameter of `init()` |
| **Site URL** | Third parameter of `init()` |
| **SCRT URL** | `scrt2URL` in the options object (if present) |

### Step 4a — Add to an Experience Cloud site

1. Go to **Setup → All Sites** and open **Builder** for your Experience Cloud site
2. From the left-hand menu, select **Components** and drag the **Inline Agent Help** component to your desired location on the page
3. In the component property panel, set:

| Property | Required / Optional | Description |
|----------|---------------------|-------------|
| **Org ID** | Required | 18-character Org ID from the Code Snippet |
| **Deployment API Name** | Required | Deployment API Name from the Code Snippet |
| **Site URL** | Required | Experience Cloud site base URL (e.g. `https://yourdomain.my.site.com/your-site`). No trailing slash |
| **SCRT URL** | Optional | SCRT URL from the Code Snippet (e.g. `https://yourdomain.my.salesforce-scrt.com`). Leave blank if not in your snippet |
| **Bootstrap Script URL** | Optional | Override the bootstrap script URL. Leave blank to auto-derive from Site URL |
| **Chat Height** | Optional | CSS height for the chat container (e.g. `550px`, `80vh`). Minimum 400px. Default: `550px` |
| **Enable Debug Logs** | Optional | Logs state transitions and performance timing to the browser console |
| **Show Canned Prompts** | Optional | Displays starter prompt buttons below the input. Labels are sourced from custom labels (see [Customization](#customization)) |

4. **Save** and **Publish** the site

### Step 4b — Embed on a third-party website

Use the [`haaInlineEnhancedChat.js`](force-app/main/default/staticresources/haaInlineEnhancedChat.js) file — a single JS file with no dependencies. After installing the package (or deploying the repo), you can also find it in your org under **Setup → Static Resources → haaInlineEnhancedChat**.

**Option 1 — Auto-init with data attributes:**

```html
<div id="agent-chat"
     data-org-id="00Dxx0000000000AAA"
     data-deployment="Your_Deployment_API_Name"
     data-site-url="https://your-domain.my.site.com/YourSite"
     data-scrt2-url=""
     data-debug>
</div>
<script src="haaInlineEnhancedChat.js" data-target="agent-chat"></script>
```

**Complete list of data attributes:**

| Attribute | Required / Optional | Description |
|-----------|---------------------|-------------|
| `data-org-id` | Required | 18-character Org ID from the Code Snippet |
| `data-deployment` | Required | Deployment API Name from the Code Snippet (also accepts `data-deployment-api-name`) |
| `data-site-url` | Required | Experience Cloud site base URL. No trailing slash |
| `data-scrt2-url` | Optional | SCRT URL from the Code Snippet. Leave blank if not in your snippet |
| `data-bootstrap-url` | Optional | Override the bootstrap script URL. Omit to auto-derive from Site URL |
| `data-heading` | Optional | Custom heading text. Default: "How can we help?" |
| `data-placeholder` | Optional | Custom input placeholder text. Default: "Type your question here..." |
| `data-starter-prompt-1` | Optional | First starter prompt button label |
| `data-starter-prompt-2` | Optional | Second starter prompt button label |
| `data-starter-prompt-3` | Optional | Third starter prompt button label |
| `data-debug` | Optional | Enable console logging (presence attribute — no value needed) |

**Option 2 — Explicit JavaScript init:**

```js
EnhancedChatInline.init({
  containerId: 'agent-chat',          // Required — ID of the container element
  orgId: '00Dxx0000000000AAA',        // Required
  deploymentApiName: 'Your_API_Name', // Required
  siteUrl: 'https://your-domain.my.site.com/YourSite', // Required
  scrt2Url: '',                       // Optional
  bootstrapScriptUrl: '',             // Optional
  heading: '',                        // Optional — custom heading text
  placeholder: '',                    // Optional — custom input placeholder
  quickActions: ['Prompt 1', 'Prompt 2', 'Prompt 3'], // Optional — up to 3
  debug: true                         // Optional — logs to console
});
```

> **Important:** Your hosting origin must be allowed in the deployment's **Trusted Domains** and CSP settings. If the console shows CORS or frame-ancestors errors, add your domain to **Setup → Embedded Service Deployments → your deployment → settings**.

---

## Customization

### Text and labels

All UI text is externalized as Salesforce custom labels prefixed with `HAA_`. Edit them in **Setup → Custom Labels**:

- **Heading, placeholder, button text** — `HAA_heading`, `HAA_input_placeholder`, `HAA_submit_altText`, etc.
- **Error messages** — `HAA_error_timeout`, `HAA_error_scriptLoadFailed`, `HAA_error_launchFailed`, etc.
- **Canned prompts** — `HAA_canned_prompt_one`, `HAA_canned_prompt_two`, `HAA_canned_prompt_three`. Set any label value to `skip` to hide that button.

### Styling

The component inherits colors and fonts from your site theme automatically via SLDS design tokens (`--slds-g-*`) and CSS `inherit`. No hardcoded brand colors — it adapts to any theme.

---

## Troubleshooting

- **Chat not loading** — Verify Org ID, Deployment API Name, and Site URL match the Code Snippet exactly. Check that the deployment is published and the messaging channel is active.
- **Timeout error** — Enable debug logs and check the browser console for which lifecycle event didn't fire. Common causes: deployment not published, site URL mismatch, or messaging channel not activated.
- **CORS / frame-ancestors errors** (third-party embed) — Add your hosting domain to the deployment's Trusted Domains in Setup.
- **FAB still visible briefly** — Expected; `hideChatButton()` runs as soon as the API is available.
- **Changes not taking effect** — Republish the Experience Cloud site after deploying. Browser hard-refresh alone is not enough due to site-level caching.
- **Debug mode** — Enable debug logs to see FSM state transitions (`[HAA] state PROMPT -> LOADING [SUBMIT]`) and time-to-active performance measurements in the browser console.

### Agentforce Data Library troubleshooting

- **INSUFFICIENT_ACCESS_OR_READONLY error** — If the agent returns a "something went wrong" message and the error trace contains `statusCode: INSUFFICIENT_ACCESS_OR_READONLY` with a message about not having access to fields used by the data library, the agent's user lacks Knowledge access. Go to **Setup → Permission Sets**, find the agent's permission set (e.g. **Agentforce Agent haaHelpAgent Permissions**), and enable the **Allow View Knowledge** app permission.

- **Generic AI responses or "I don't know" despite articles existing** — Check the following:
  1. **Public article visibility** — If the ADL is configured to search only Public Knowledge Articles, verify that your articles are published **and** set to **Visible In Public Knowledge Base**.
  2. **Data Category access** — If some or all knowledge seems unavailable to the agent, check that the agent's Permission Sets grant access to the necessary **Data Categories** containing your articles.
  3. **Vague or incomplete answers from correct articles** — If the agent identifies the right article but gives vague, incomplete, or "article is empty" responses, verify that the agent's Permission Sets include read access to the relevant **Knowledge fields** (Title, Summary, your content field) and that the same fields are selected in the ADL's **Content Fields** configuration.

- **Agent says it has no data to answer questions** — Check the ADL status and its associated Search Index in Data Cloud:
  1. In the **App Launcher**, select **Data Cloud** and navigate to **Search Indexes**
  2. Find the Search Index named `KA_` + your ADL name (e.g. `KA_Help_Agent_Knowledge`)
  3. Open the **Process History** tab and verify the job ran successfully and processed records
  4. If the job did not run or processed zero records, click **Rebuild** to re-index

---

## Documentation

- [Enhanced Chat inline mode — Salesforce Developer Docs](https://developer.salesforce.com/docs/ai/agentforce/guide/enhanced-chat-inline-mode.html)
