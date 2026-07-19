import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalWhatsappJid,
  whatsappJidAlias,
  type WhatsappIdentity,
} from "../lib/whatsapp-jids.ts";

const contact = {
  lid: "242305042780211@lid",
  phone: "557592315646@s.whatsapp.net",
};

test("links an outgoing LID chat to RecipientAlt", () => {
  const identity: WhatsappIdentity = {
    remoteJid: contact.lid,
    fromMe: true,
    sender: "110347121864714@lid",
    recipientAlt: contact.phone,
  };

  assert.equal(canonicalWhatsappJid(identity), contact.phone);
  assert.deepEqual(whatsappJidAlias(identity), {
    aliasJid: contact.lid,
    canonicalJid: contact.phone,
  });
});

test("links an incoming LID chat to SenderAlt", () => {
  const identity: WhatsappIdentity = {
    remoteJid: contact.lid,
    fromMe: false,
    sender: contact.lid,
    senderAlt: contact.phone,
  };

  assert.equal(canonicalWhatsappJid(identity), contact.phone);
  assert.deepEqual(whatsappJidAlias(identity), {
    aliasJid: contact.lid,
    canonicalJid: contact.phone,
  });
});

test("keeps an unmapped incoming LID as the delivery conversation", () => {
  const identity: WhatsappIdentity = {
    remoteJid: contact.lid,
    fromMe: false,
    sender: contact.lid,
  };

  assert.equal(canonicalWhatsappJid(identity), contact.lid);
  assert.equal(whatsappJidAlias(identity), null);
});

test("does not link the sender's own LID to an outgoing phone chat", () => {
  const identity: WhatsappIdentity = {
    remoteJid: contact.phone,
    fromMe: true,
    senderAlt: "110347121864714@lid",
    recipientAlt: contact.phone,
  };

  assert.equal(canonicalWhatsappJid(identity), contact.phone);
  assert.equal(whatsappJidAlias(identity), null);
});

test("learns participant aliases without replacing a group chat", () => {
  const identity: WhatsappIdentity = {
    remoteJid: "120363409874959982@g.us",
    fromMe: false,
    sender: contact.phone,
    senderAlt: contact.lid,
  };

  assert.equal(canonicalWhatsappJid(identity), identity.remoteJid);
  assert.deepEqual(whatsappJidAlias(identity), {
    aliasJid: contact.lid,
    canonicalJid: contact.phone,
  });
});
