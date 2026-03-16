# WhatsApp Cloud API — Embedded Signup Reference

> **Author:** Vobase
> **API Version:** v22.0
> **Last Updated:** 2026-03-16

---

## Overview

Embedded Signup is Meta's authentication and authorization interface that allows businesses to self-onboard to the WhatsApp Business Platform through your website or portal. It uses Facebook Login for Business and Meta's JavaScript SDK to:

- Collect business information from the customer
- Create all necessary WhatsApp assets (WABA, phone number registration)
- Grant your app access to those assets

On completion, the flow returns three values:

| Value | Description |
|-------|-------------|
| `waba_id` | The customer's WhatsApp Business Account ID |
| `phone_number_id` | The registered phone number ID |
| `code` | A short-lived authorization code (~60 seconds) |

Your backend then exchanges the `code` for a long-lived Business Integration System User (BISU) access token.

---

## Prerequisites

### Partner Type

- You must be a **Tech Provider** or **Solution Partner** in Meta's partner program.
- Your business portfolio must be verified with Meta.
- Your Meta Developer App must be in **Live mode** (not Development) to receive webhooks from real users.

### Facebook App Configuration

In **App Dashboard > Facebook Login for Business > Settings > Client OAuth settings**, enable:

| Setting | Value |
|---------|-------|
| Login with the JavaScript SDK | Yes |
| Use Strict Mode for redirect URIs | Yes |
| Embedded Browser OAuth Login | Yes |
| Enforce HTTPS | Yes |
| Web OAuth Login | Yes |
| Client OAuth Login | Yes |

Add every domain where you deploy Embedded Signup (including test/staging) to both **Allowed Domains** and **Valid OAuth Redirect URIs**. Only HTTPS domains are supported.

### Login for Business Configuration ID

Navigate to **Facebook Login for Business > Configurations** and create a configuration from the template:

> "WhatsApp Embedded Signup Configuration With 60 Expiration Token"

This template grants the common permissions: `whatsapp_business_management`, `whatsapp_business_messaging`, `business_management`. Record the **Configuration ID**.

### Required Permissions

| Permission | Access Level |
|------------|-------------|
| `whatsapp_business_management` | Advanced Access |
| `whatsapp_business_messaging` | Advanced Access |
| `business_management` | Standard Access |

---

## Implementation

### Step 1: Load the Facebook JavaScript SDK

```html
<script>
  window.fbAsyncInit = function () {
    FB.init({
      appId: '{YOUR-FACEBOOK-APP-ID}',
      cookie: true,
      xfbml: true,
      version: 'v22.0',
    });
  };

  (function (d, s, id) {
    var js, fjs = d.getElementsByTagName(s)[0];
    if (d.getElementById(id)) return;
    js = d.createElement(s);
    js.id = id;
    js.setAttribute('defer', true);
    js.src = 'https://connect.facebook.net/en_US/sdk.js';
    fjs.parentNode.insertBefore(js, fjs);
  })(document, 'script', 'facebook-jssdk');
</script>
```

### Step 2: Register the Session Info Listener

Register this **before** calling `FB.login`. It receives real-time events from the popup window.

```javascript
const sessionInfoListener = (event) => {
  if (!event.origin?.endsWith('facebook.com')) return;

  try {
    const data = JSON.parse(event.data);
    if (data.type === 'WA_EMBEDDED_SIGNUP') {
      if (data.event === 'FINISH') {
        const { phone_number_id, waba_id } = data.data;
        console.log('WABA ID:', waba_id, 'Phone:', phone_number_id);
      } else if (data.event === 'ERROR') {
        console.error('Embedded Signup error:', data.data.error_message);
      } else if (data.event === 'CANCEL') {
        console.warn('Cancelled at step:', data.data.current_step);
      }
    }
  } catch {
    // Non-JSON messages from other sources — ignore
  }
};

window.addEventListener('message', sessionInfoListener);
```

#### Session Event Payload

```typescript
{
  type: 'WA_EMBEDDED_SIGNUP';
  event: 'FINISH' | 'CANCEL' | 'ERROR';
  data: {
    phone_number_id: string;
    waba_id: string;
    businessId: string;       // business portfolio ID
    // Optional, if granted:
    ad_account_ids?: string[];
    page_ids?: string[];
    dataset_ids?: string[];
    // CANCEL-specific:
    current_step?: string;
    // ERROR-specific:
    error_message?: string;
  };
}
```

### Step 3: Launch the Signup Flow

```javascript
function launchWhatsAppSignup() {
  FB.login(
    function (response) {
      if (response.status === 'connected' && response.authResponse) {
        const code = response.authResponse.code;
        // Send code to your backend IMMEDIATELY — expires in ~60 seconds
        sendCodeToBackend(code);
      }
    },
    {
      config_id: '{YOUR-CONFIGURATION-ID}',
      response_type: 'code',
      override_default_response_type: true,
      extras: {
        sessionInfoVersion: '3',
        features: [{ name: 'marketing_messages_lite' }],
        setup: {
          solutionID: '{YOUR-SOLUTION-ID}', // optional, Solution Partners only
        },
      },
    }
  );
}
```

#### `FB.login` Parameters

| Parameter | Value | Notes |
|-----------|-------|-------|
| `config_id` | Configuration ID | From Facebook Login for Business |
| `response_type` | `'code'` | Required for BISU token flow |
| `override_default_response_type` | `true` | Must be `true` when using `response_type: 'code'` |
| `sessionInfoVersion` | `'3'` | Enables `WA_EMBEDDED_SIGNUP` postMessage events |
| `solutionID` | Solution ID | Optional, for Solution Partners |

#### What the Customer Sees

1. Login with Facebook/Meta credentials
2. Select or create a Business Portfolio (Meta Business Manager)
3. Create a WhatsApp Business Account name
4. Accept terms of service (Cloud API, WhatsApp Business, Marketing Messages Lite)
5. Enter and verify their phone number (or select an existing number)
6. Grant permissions to your app

---

## Post-Signup Backend Flow

### Step 4: Exchange Code for Token

**Do this server-side only. The code expires in ~60 seconds.**

```
POST https://graph.facebook.com/v22.0/oauth/access_token
```

| Parameter | Description |
|-----------|-------------|
| `client_id` | Your Facebook App ID |
| `client_secret` | Your Facebook App Secret |
| `code` | The code from `response.authResponse.code` |
| `redirect_uri` | Must match a registered OAuth redirect URI |

```bash
curl -X POST "https://graph.facebook.com/v22.0/oauth/access_token" \
  -d "client_id={APP_ID}" \
  -d "client_secret={APP_SECRET}" \
  -d "code={CODE}" \
  -d "redirect_uri={REDIRECT_URI}"
```

**Response:**

```json
{
  "access_token": "EAAJf...",
  "token_type": "bearer"
}
```

This returns a **Business Integration System User (BISU) access token**. Store it encrypted at rest.

### Step 5: Subscribe App to WABA Webhooks

```bash
curl -X POST \
  "https://graph.facebook.com/v22.0/{WABA_ID}/subscribed_apps" \
  -H "Authorization: Bearer {BISU_TOKEN}"
```

Your app must be in **Live mode** to receive real webhooks. Subscribe to the `messages` field.

### Step 6: Register the Phone Number

```bash
curl -X POST \
  "https://graph.facebook.com/v22.0/{PHONE_NUMBER_ID}/register" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {BISU_TOKEN}" \
  -d '{
    "messaging_product": "whatsapp",
    "pin": "YOUR_6_DIGIT_PIN"
  }'
```

**Response:**

```json
{ "success": true }
```

### Step 7: (Solution Partners Only) Share Credit Line

Solution Partners must share their credit line with the customer's WABA before messages can be sent. This does not apply to Tech Providers.

---

## Pre-Filling Customer Data

Reduce friction by pre-filling business information:

```javascript
extras: {
  setup: {
    business: {
      name: 'Acme Corp',
      email: 'admin@acme.com',
      website: 'https://acme.com',
      phone: {
        code: '1',
        number: '5551234567'
      },
      address: {
        streetAddress1: '123 Main St',
        city: 'San Francisco',
        state: 'CA',
        zipPostal: '94105',
        country: 'US'
      }
    },
    phone: {
      displayName: 'Acme Support',
      category: 'BEAUTY_SPA',
      description: 'Customer support line'
    }
  }
}
```

---

## API Calls Summary

| Step | Method | Endpoint | Auth |
|------|--------|----------|------|
| Exchange code | POST | `/v22.0/oauth/access_token` | `client_id` + `client_secret` + `code` |
| Debug token | GET | `/v22.0/debug_token?input_token={TOKEN}` | `{APP_ID}\|{APP_SECRET}` |
| List WABAs | GET | `/v22.0/{BUSINESS_ID}/client_whatsapp_business_accounts` | System User token |
| Subscribe webhooks | POST | `/v22.0/{WABA_ID}/subscribed_apps` | BISU token |
| Get phone numbers | GET | `/v22.0/{WABA_ID}/phone_numbers` | BISU token |
| Register phone | POST | `/v22.0/{PHONE_NUMBER_ID}/register` | BISU token |
| Get WABA details | GET | `/v22.0/{WABA_ID}` | BISU token |

---

## Flow Variants

| Variant | Use Case |
|---------|----------|
| Default (Cloud API) | Customer creates new WABA and phone number |
| Coexistence | Customer already using WhatsApp Business App on that number |
| Pre-verified phone number | You supply a pre-verified number, bypassing entry |
| App-only install | Business App coexistence flow |

### Coexistence Mode

Coexistence allows a business to use the WhatsApp Business App **and** the Cloud API simultaneously on the same number. This is the most common Embedded Signup scenario — businesses already chatting on the WhatsApp Business App who want to add API capabilities.

Key points:
- Requires WhatsApp Business App **v2.24.17+** and at least 7 days of active usage
- 1:1 chat history (6 months) and contacts sync at onboarding; group chats do not sync
- Disappearing messages and view-once are automatically disabled
- Business App must be opened at least every **14 days** or the connection expires
- Offboarding must be done in the Business App, not via API

For full details, feature compatibility matrix, SMB echo webhooks, and gotchas, see [coexistence.md](coexistence.md).

---

## Error Handling

### `FB.login` Response Statuses

| `response.status` | Meaning |
|-------------------|---------|
| `connected` | Success — `response.authResponse.code` is populated |
| `not_authorized` | User logged in but did not authorize the app |
| (other / missing) | User cancelled or did not complete |

### Flow Errors (During Popup)

| Error | Resolution |
|-------|------------|
| Business Manager not found | Verify the Business Manager ID |
| You don't have admin permissions | Use an account with Admin role on the BM |
| Business already linked to another WABA | Use existing WABA or create new BM |
| Meta requires Business Verification | Complete verification in Security Center |
| Business Manager creation blocked | Contact Meta Support |
| App not approved for WhatsApp | Submit for App Review in App Dashboard |
| Two-factor authentication not enabled | Enable 2FA in Facebook Security Settings |
| Number banned or flagged | Request review with Meta Support |
| Business policy compliance rejection | Check WhatsApp Business Policy restricted categories |
| Your Facebook account is too new | Use an existing active account |
| `SDK_LOAD_ERROR` | Check CSP / firewalls blocking `connect.facebook.net` |

### Post-Signup API Errors

| Code | Subcode | Meaning | Fix |
|------|---------|---------|-----|
| 190 | 460 | Session invalidated (user changed password) | Re-run Embedded Signup |
| 100 | — | Cannot override callback URI before subscribing | Call `/subscribed_apps` first |
| 200 | — | System user lacks access to resource | Grant system user access to WABA |

### Common Pitfalls

1. **Code expiration** — The authorization `code` expires in ~60 seconds. Exchange it immediately server-side.
2. **Development mode** — Only test users can complete the flow in Dev mode. Switch to Live mode for real users.
3. **Localhost** — The code works locally, but the `redirect_uri` in the token exchange must match a registered domain.
4. **Token storage** — BISU tokens must be encrypted at rest. Never store raw access tokens in unencrypted databases.
5. **Webhook subscription order** — Subscribe your app (`POST /{WABA_ID}/subscribed_apps`) before attempting to override the callback URI.

---

## Sources

- [WhatsApp Embedded Signup — Overview](https://developers.facebook.com/docs/whatsapp/embedded-signup)
- [WhatsApp Embedded Signup — Implementation](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation/)
- [WhatsApp Embedded Signup — Manage Accounts](https://developers.facebook.com/docs/whatsapp/embedded-signup/manage-accounts)
- [WhatsApp Embedded Signup — Errors](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/errors/)
- [WhatsApp Embedded Signup — Onboarding as Tech Provider](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider/)
- [WhatsApp Access Tokens Guide](https://developers.facebook.com/docs/whatsapp/access-tokens)
