import type { Core } from "@strapi/strapi";
import { getGithubAuth } from "./get-github-auth";
import { CONFIG } from "../config";

const name = "GitHub Action";

export const setUpGithubWebhook = async (strapi: Core.Strapi) => {
  const webhookStore =
    "webhookStore" in strapi
      ? strapi.webhookStore // v4
      : await strapi.get("webhookStore"); // v5

  try {
    const webhooks = await webhookStore.findWebhooks();
    const oldWebhook = webhooks.find((webhook) => webhook.name === name);
    if (oldWebhook) {
      await webhookStore.deleteWebhook(oldWebhook.id);
    }
  } catch (error) {
    console.error(`Unable to prepare "${name}" webhook`, error);
  }

  try {
    await webhookStore.createWebhook({
      id: "",
      events: [],
      headers: {
        "x-authorization": getGithubAuth(),
      },
      isEnabled: true,
      name,
      url: `http://localhost:${CONFIG.PORT}/api/github?event_type=${CONFIG.GITHUB.EVENT_TYPE}`,
    });
  } catch (error) {
    console.error(`Unable to create "${name}" webhook`, error);
  }
};
