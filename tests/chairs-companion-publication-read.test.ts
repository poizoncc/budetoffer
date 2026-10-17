import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  readPublicationResumeArtifacts,
  createPublicationCheckpointStore,
  recoverPublicationReceipt,
} from "../apps/chrome-companion/background/publication.ts";
import { isJobResult } from "../apps/chrome-companion/shared/companion-protocol.ts";
import type { ResumeArtifact } from "../apps/chrome-companion/shared/companion-protocol.ts";
import { serializedRecord } from "./helpers/dom.ts";

interface SelectedSkill {
  id: number;
  name: string;
  general: boolean | string;
  extra?: boolean;
}
interface PublicationPageState {
  userType: string;
  userId: string | undefined;
  account: Record<string, unknown>;
  hhidAccount: Record<string, unknown>;
  session: Record<
    | "isFallback"
    | "securityCheckFailed"
    | "isMultiAccount"
    | "hasExtraAccounts",
    boolean
  >;
  applicantResume: {
    forbidden: null | { reason: string };
    _attributes: { hash: string; id: string; user: string; permission: string };
    applicantUserStatuses: Record<string, { jobSearchStatus: string }>;
    resumeApplicantSkills: Array<{
      id: number;
      name: string;
      category: string;
    }>;
    advancedKeySkills: SelectedSkill[];
    keySkills: Array<{ string: string; extra?: boolean }>;
  };
}
type ChangePage = (state: PublicationPageState) => void;

function validateResumeArtifactReadback(value: unknown): ResumeArtifact {
  const result: unknown = { kind: "read_resume_artifact", artifact: value };
  if (!isJobResult(result) || result.kind !== "read_resume_artifact") {
    throw new Error("invalid_resume_artifact_readback");
  }
  return result.artifact;
}

const target = {
  resumeId: "resume-copy",
  internalId: "42",
  hhAccountKey: "hh-applicant-101",
};
function page(
  change: ChangePage = () => {},
  url = `https://hh.ru/resume/${target.resumeId}`,
) {
  const state: PublicationPageState = {
    userType: "applicant",
    userId: "101",
    account: {},
    hhidAccount: {},
    session: {
      isFallback: false,
      securityCheckFailed: false,
      isMultiAccount: false,
      hasExtraAccounts: false,
    },
    applicantResume: {
      forbidden: null,
      _attributes: {
        hash: target.resumeId,
        id: target.internalId,
        user: "101",
        permission: "edit",
      },
      applicantUserStatuses: { "101": { jobSearchStatus: "synthetic" } },
      resumeApplicantSkills: [
        { id: 1, name: "Node.js", category: "SKILL" },
        { id: 2, name: "PostgreSQL", category: "SKILL" },
      ],
      advancedKeySkills: [
        { id: 1, name: "Node.js", general: true },
        { id: 2, name: "PostgreSQL", general: false },
      ],
      keySkills: [{ string: "Node.js" }, { string: "PostgreSQL" }],
    },
  };
  change(state);
  const dom = new JSDOM(
    `<template id="HH-Lux-InitialState">${JSON.stringify(state)}</template>
    <h1 data-qa="resume-block-title-position">Backend Lead</h1>
    <div data-qa="resume-about-card"><p>Build reliable backend APIs.<br>Improve delivery quality.</p><button>Развернуть</button><button data-qa="resume-edit-button-about"></button></div>
    <div data-qa="skills-card"><div data-qa="skill-tag-2">PostgreSQL</div><div data-qa="skill-tag-1">Node.js</div></div>`,
    { url, runScripts: "outside-only" },
  );
  return Object.assign(dom, { fixtureState: state });
}
test("owned resume full text includes career, education and additional fields while excluding page navigation and session state", () => {
  const dom = page();
  const doc = dom.window.document,
    root = doc.createElement("main");
  for (const child of Array.from(doc.body.children)) root.append(child);
  root.insertAdjacentHTML(
    "beforeend",
    '<section data-qa="resume-experience-card"><h2>Опыт работы</h2><p>Example company</p><p>2020–2026</p><div style="-webkit-line-clamp:2">Полное описание обязанностей без сокращения</div></section><section><h2>Образование</h2><p>Synthetic university</p><p>Английский — B2</p><p>Готовность к переезду</p></section><aside>Buy advertisement</aside><nav>Global navigation</nav><script>secret-session-token</script>',
  );
  doc.body.append(root);
  const artifact = readPublicationResumeArtifacts(
    target,
    doc,
    dom.window.location.href,
  );
  for (const field of [
    "Опыт работы",
    "Example company",
    "2020–2026",
    "Полное описание обязанностей без сокращения",
    "Образование",
    "Synthetic university",
    "Английский — B2",
    "Готовность к переезду",
  ])
    assert.ok(artifact.fullText?.includes(field), field);
  for (const forbidden of [
    "secret-session-token",
    "HH-Lux-InitialState",
    "Buy advertisement",
    "Global navigation",
    "Развернуть",
  ])
    assert.ok(!artifact.fullText?.includes(forbidden), forbidden);
  assert.equal(isJobResult({ kind: "read_resume_artifact", artifact }), true);
});
test("serialized static reader uses grounded owned resume fields and full text without clicks", () => {
  const dom = page();
  let clicks = 0;
  dom.window.document.querySelectorAll("button").forEach((button) =>
    button.addEventListener("click", () => {
      clicks++;
    }),
  );
  try {
    const read = serializedRecord(dom, readPublicationResumeArtifacts, target);
    const value = validateResumeArtifactReadback(
      JSON.parse(JSON.stringify(read)),
    );
    assert.equal(
      value.about,
      "Build reliable backend APIs. Improve delivery quality.",
    );
    assert.deepEqual(value.keySkills, ["PostgreSQL", "Node.js"]);
    assert.equal("published" in value, false);
    assert.equal("owned" in value, false);
    assert.equal(clicks, 0);
  } finally {
    dom.window.close();
  }
});
test("30 selected skills match DOM and both selected arrays while 83-entry catalog extras stay out of readback", () => {
  const selected = Array.from({ length: 30 }, (_, i) => ({
    id: i + 1,
    name: `Synthetic selected ${i + 1}`,
    general: i % 2 === 0,
  }));
  const dom = page((state) => {
    state.applicantResume.advancedKeySkills = selected;
    state.applicantResume.keySkills = [...selected]
      .reverse()
      .map((skill) => ({ string: ` ${skill.name} ` }));
    state.applicantResume.resumeApplicantSkills = [
      ...selected.map(({ id, name }) => ({ id, name, category: "SKILL" })),
      ...Array.from({ length: 51 }, (_, i) => ({
        id: i + 31,
        name: `Synthetic unselected ${i + 1}`,
        category: "SKILL",
      })),
      { id: 82, name: "Synthetic language one", category: "LANG" },
      { id: 83, name: "Synthetic language two", category: "LANG" },
    ];
  });
  try {
    const card = dom.window.document.querySelector('[data-qa="skills-card"]')!;
    card.replaceChildren();
    for (const skill of [...selected].reverse()) {
      const tag = dom.window.document.createElement("div");
      tag.setAttribute("data-qa", `skill-tag-${skill.id}`);
      tag.textContent = skill.name;
      card.append(tag);
    }
    const read = validateResumeArtifactReadback(
      serializedRecord(dom, readPublicationResumeArtifacts, target),
    );
    assert.deepEqual(
      Array.from(read.keySkills),
      [...selected].reverse().map((skill) => skill.name),
    );
    assert.equal(read.keySkills.length, 30);
    assert.doesNotMatch(JSON.stringify(read), /unselected|language/);
    const extra = dom.window.document.createElement("div");
    extra.setAttribute("data-qa", "skill-tag-31");
    extra.textContent = "Synthetic unselected 1";
    card.append(extra);
    assert.throws(
      () =>
        readPublicationResumeArtifacts(
          target,
          dom.window.document,
          dom.window.location.href,
        ),
      /skill_projection_incomplete/,
    );
    extra.remove();
    const template = dom.window.document.querySelector("template")!;
    const state = dom.fixtureState;
    state.applicantResume.advancedKeySkills.push({
      id: 31,
      name: "Synthetic unselected 1",
      general: false,
    });
    state.applicantResume.keySkills.push({ string: "Synthetic unselected 1" });
    template.innerHTML = JSON.stringify(state);
    assert.throws(
      () =>
        readPublicationResumeArtifacts(
          target,
          dom.window.document,
          dom.window.location.href,
        ),
      /skill_projection_incomplete/,
    );
  } finally {
    dom.window.close();
  }
});
test("missing, duplicate, ambiguous selected arrays and catalog mismatches deny full projection", () => {
  const changes: ChangePage[] = [
    (s) => {
      Reflect.deleteProperty(s.applicantResume, "advancedKeySkills");
    },
    (s) => {
      Reflect.deleteProperty(s.applicantResume, "keySkills");
    },
    (s) => {
      s.applicantResume.advancedKeySkills.pop();
    },
    (s) => {
      s.applicantResume.keySkills.pop();
    },
    (s) => {
      s.applicantResume.advancedKeySkills[1] = {
        ...s.applicantResume.advancedKeySkills[0],
      };
    },
    (s) => {
      s.applicantResume.advancedKeySkills[1].name = "Node.js";
    },
    (s) => {
      s.applicantResume.keySkills[1] = { string: "Node.js" };
    },
    (s) => {
      s.applicantResume.keySkills[1] = { string: "Unselected" };
    },
    (s) => {
      s.applicantResume.keySkills[0].extra = true;
    },
    (s) => {
      s.applicantResume.advancedKeySkills[0].general = "true";
    },
    (s) => {
      s.applicantResume.advancedKeySkills[0].extra = true;
    },
    (s) => {
      s.applicantResume.resumeApplicantSkills[0].category = "LANG";
    },
    (s) => {
      s.applicantResume.resumeApplicantSkills[0].name = "Mismatch";
    },
    (s) => {
      s.applicantResume.resumeApplicantSkills.pop();
    },
    (s) => {
      s.applicantResume.resumeApplicantSkills.push({
        ...s.applicantResume.resumeApplicantSkills[0],
      });
    },
  ];
  for (const change of changes) {
    const dom = page(change);
    try {
      assert.throws(
        () =>
          readPublicationResumeArtifacts(
            target,
            dom.window.document,
            dom.window.location.href,
          ),
        /skill_projection_incomplete/,
      );
    } finally {
      dom.window.close();
    }
  }
  const dom = page();
  try {
    const tags = dom.window.document.querySelectorAll(
      '[data-qa^="skill-tag-"]',
    );
    tags[1].setAttribute("data-qa", tags[0].getAttribute("data-qa")!);
    tags[1].textContent = tags[0].textContent;
    assert.throws(
      () =>
        readPublicationResumeArtifacts(
          target,
          dom.window.document,
          dom.window.location.href,
        ),
      /skill_projection_incomplete/,
    );
  } finally {
    dom.window.close();
  }
});
test("missing owner proof, changed target, duplicate fields and hidden/truncated about stop readback", () => {
  const changes: ChangePage[] = [
    (s) => {
      s.userId = undefined;
    },
    (s) => {
      s.applicantResume._attributes.user = "202";
    },
    (s) => {
      s.session.isMultiAccount = true;
    },
  ];
  for (const change of changes) {
    const dom = page(change);
    try {
      assert.throws(
        () =>
          readPublicationResumeArtifacts(
            target,
            dom.window.document,
            dom.window.location.href,
          ),
        /ownership_unverified/,
      );
    } finally {
      dom.window.close();
    }
  }
  const dom = page();
  try {
    assert.throws(
      () =>
        readPublicationResumeArtifacts(
          target,
          dom.window.document,
          "https://hh.ru/resume/other-copy",
        ),
      /target_changed/,
    );
    dom.window.document.querySelector("p")!.innerHTML = "Partial description…";
    assert.throws(
      () =>
        readPublicationResumeArtifacts(
          target,
          dom.window.document,
          dom.window.location.href,
        ),
      /projection_incomplete/,
    );
    dom.window.document.querySelector("p")!.innerHTML =
      "Complete description <span hidden>other content</span>";
    assert.throws(
      () =>
        readPublicationResumeArtifacts(
          target,
          dom.window.document,
          dom.window.location.href,
        ),
      /projection_incomplete/,
    );
  } finally {
    dom.window.close();
  }
});
for (const host of ["hh.ru", "kaliningrad.hh.ru", "spb.hh.ru"]) {
  for (const query of ["", "?hhtmFrom=applicant_profile"]) {
    test(`serialized owned resume read accepts ${host} ${query || "without query"} without effects`, () => {
      const expected = {
        kind: "resume_artifact_readback",
        readerVersion: "hh-owned-resume-dom-v1",
        ...target,
        headline: "Backend Lead",
        about: "Build reliable backend APIs. Improve delivery quality.",
        keySkills: ["PostgreSQL", "Node.js"],
      };
      const url = `https://${host}/resume/${target.resumeId}${query}`;
      const dom = page((state) => {
        state.applicantResume.resumeApplicantSkills.push({
          id: 3,
          name: "Synthetic unselected catalog skill",
          category: "SKILL",
        });
      }, url);
      let clicks = 0;
      let submits = 0;
      dom.window.document.addEventListener("click", () => {
        clicks++;
      });
      dom.window.document.addEventListener("submit", () => {
        submits++;
      });
      try {
        const before = dom.window.document.documentElement.outerHTML;
        const read = serializedRecord(
          dom,
          readPublicationResumeArtifacts,
          target,
        );
        assert.deepEqual(
          validateResumeArtifactReadback(JSON.parse(JSON.stringify(read))),
          expected,
          url,
        );
        assert.doesNotMatch(JSON.stringify(read), /unselected catalog/);
        assert.equal("published" in read, false);
        assert.equal("owned" in read, false);
        assert.equal(clicks, 0);
        assert.equal(submits, 0);
        assert.equal(dom.window.document.documentElement.outerHTML, before);
        assert.equal(dom.window.location.href, url);
      } finally {
        dom.window.close();
      }
    });
  }
}
test("owned resume read rejects HH lookalikes, changed path and unsafe navigation controls", () => {
  const path = `/resume/${target.resumeId}`;
  const profile = "?hhtmFrom=applicant_profile";
  const urls = [
    `https://evilhh.ru${path}${profile}`,
    `https://hh.ru.attacker.example${path}${profile}`,
    `https://kaliningrad.hh.ru.attacker.example${path}${profile}`,
    `https://kaliningrad-hh.ru${path}${profile}`,
    `https://kaliningrad.hh.ru.${path}${profile}`,
    `http://kaliningrad.hh.ru${path}${profile}`,
    `https://kaliningrad.hh.ru:444${path}${profile}`,
    `https://synthetic-user@kaliningrad.hh.ru${path}${profile}`,
    `https://synthetic-user:synthetic-pass@kaliningrad.hh.ru${path}${profile}`,
    `https://kaliningrad.hh.ru/resume/other-copy${profile}`,
    `https://kaliningrad.hh.ru${path}/${profile}`,
    `https://kaliningrad.hh.ru/resume/edit/${target.resumeId}${profile}`,
    `https://kaliningrad.hh.ru${path}${profile}#synthetic-fragment`,
    `https://kaliningrad.hh.ru${path}?hhtmFrom=applicant_profile&hhtmFrom=applicant_profile`,
    `https://kaliningrad.hh.ru${path}?hhtmFrom=applicant_profile&hhtmFrom=attacker`,
    `https://kaliningrad.hh.ru${path}?hhtmFrom=attacker&hhtmFrom=applicant_profile`,
    `https://kaliningrad.hh.ru${path}?hhtmFrom=applicant_profile&next=https%3A%2F%2Fattacker.example`,
    `https://kaliningrad.hh.ru${path}?hhtmFrom=applicant_profile&resume=other-copy`,
    `https://kaliningrad.hh.ru${path}?hhtmFrom=applicant_profile&hhtmFromLabel=unknown`,
    `https://kaliningrad.hh.ru${path}?hhtmFrom=unknown`,
    `https://kaliningrad.hh.ru${path}?hhtmFrom=`,
    `https://kaliningrad.hh.ru${path}?unknown=applicant_profile`,
    `https://kaliningrad.hh.ru${path}?%68htmFrom=applicant_profile`,
    `https://kaliningrad.hh.ru${path}?hhtmFrom=applicant%5Fprofile`,
    `https://kaliningrad.hh.ru${path}?hhtmFrom=applicant_profile&`,
  ];
  const dom = page();
  try {
    for (const url of urls) {
      assert.throws(
        () => readPublicationResumeArtifacts(target, dom.window.document, url),
        /resume_read_target_changed/,
        url,
      );
    }
  } finally {
    dom.window.close();
  }
});
test("regional profile link still requires exact applicant account, resume ownership and safe session", () => {
  const url = `https://kaliningrad.hh.ru/resume/${target.resumeId}?hhtmFrom=applicant_profile`;
  const sessionKeys: Array<keyof PublicationPageState["session"]> = [
    "isFallback",
    "securityCheckFailed",
    "isMultiAccount",
    "hasExtraAccounts",
  ];
  const changes: ChangePage[] = [
    (s) => {
      s.userType = "employer";
    },
    (s) => {
      s.userId = "202";
    },
    (s) => {
      s.applicantResume._attributes.user = "202";
    },
    (s) => {
      s.applicantResume._attributes.permission = "view";
    },
    (s) => {
      s.applicantResume._attributes.hash = "other-copy";
    },
    (s) => {
      s.applicantResume._attributes.id = "43";
    },
    (s) => {
      s.applicantResume.forbidden = { reason: "synthetic" };
    },
    (s) => {
      delete s.applicantResume.applicantUserStatuses["101"];
    },
    ...sessionKeys.map((key) => (s: PublicationPageState) => {
      s.session[key] = true;
    }),
  ];
  for (const change of changes) {
    const dom = page(change, url);
    try {
      assert.throws(
        () =>
          readPublicationResumeArtifacts(
            target,
            dom.window.document,
            dom.window.location.href,
          ),
        /resume_ownership_unverified/,
      );
    } finally {
      dom.window.close();
    }
  }
  const dom = page(() => {}, url);
  try {
    assert.throws(
      () =>
        readPublicationResumeArtifacts(
          { ...target, hhAccountKey: "hh-applicant-202" },
          dom.window.document,
          dom.window.location.href,
        ),
      /resume_ownership_unverified/,
    );
  } finally {
    dom.window.close();
  }
});
test("regional profile link denies tampered selected skill projections instead of reading catalog suggestions", () => {
  const url = `https://kaliningrad.hh.ru/resume/${target.resumeId}?hhtmFrom=applicant_profile`;
  const changes: ChangePage[] = [
    (s) => {
      s.applicantResume.advancedKeySkills[0].name =
        "Synthetic catalog suggestion";
    },
    (s) => {
      s.applicantResume.keySkills[0].string = "Synthetic catalog suggestion";
    },
    (s) => {
      s.applicantResume.resumeApplicantSkills[0].category = "LANG";
    },
    (s) => {
      s.applicantResume.advancedKeySkills.pop();
    },
    (s) => {
      s.applicantResume.keySkills.pop();
    },
  ];
  for (const change of changes) {
    const dom = page(change, url);
    try {
      assert.throws(
        () =>
          readPublicationResumeArtifacts(
            target,
            dom.window.document,
            dom.window.location.href,
          ),
        /resume_skill_projection_incomplete/,
      );
    } finally {
      dom.window.close();
    }
  }
  const dom = page((state) => {
    state.applicantResume.resumeApplicantSkills.push({
      id: 3,
      name: "Synthetic catalog suggestion",
      category: "SKILL",
    });
  }, url);
  try {
    const tag = dom.window.document.querySelector('[data-qa="skill-tag-1"]')!;
    tag.setAttribute("data-qa", "skill-tag-3");
    tag.textContent = "Synthetic catalog suggestion";
    assert.throws(
      () =>
        readPublicationResumeArtifacts(
          target,
          dom.window.document,
          dom.window.location.href,
        ),
      /resume_skill_projection_incomplete/,
    );
  } finally {
    dom.window.close();
  }
});
test("receipt recovery replays only exact persisted receipt and retains checkpoint on malformed acknowledgement", async () => {
  const data: Record<string, unknown> = {};
  const store = createPublicationCheckpointStore({
    get: async (k: string) => ({ [k]: data[k] }),
    set: async (v: object) => {
      Object.assign(data, v);
    },
    remove: async (k: string) => {
      delete data[k];
    },
  });
  const receipt = {
    receiptId: "receipt",
    revision: 0,
    phaseHash: "a".repeat(64),
    outcome: "confirmed" as const,
    proofId: "saved-proof",
    permitId: "t".repeat(43),
  };
  await store.save({
    publicationId: "publication",
    phase: "duplicate",
    revision: 0,
    phaseHash: receipt.phaseHash,
    status: "receipted",
    receipt,
  });
  let calls = 0;
  const transport = {
    receipt: async (id: string, r: unknown) => {
      assert.equal(id, "publication");
      assert.deepEqual(r, receipt);
      calls++;
      return calls === 1
        ? { id: "wrong" }
        : {
            id: "publication",
            revision: 1,
            state: "ready",
            phase: "bind_copy",
            phaseHash: "b".repeat(64),
          };
    },
    permit: async () => assert.fail("no permit in receipt recovery"),
  };
  assert.equal(
    (await recoverPublicationReceipt({ transport, checkpoints: store }))
      .outcome,
    "unknown",
  );
  assert.ok(await store.load());
  assert.equal(
    (await recoverPublicationReceipt({ transport, checkpoints: store }))
      .outcome,
    "confirmed",
  );
  assert.equal(await store.load(), null);
  await store.save({
    publicationId: "publication",
    phase: "duplicate",
    revision: 0,
    phaseHash: receipt.phaseHash,
    status: "authorized",
  });
  assert.equal(
    (await recoverPublicationReceipt({ transport, checkpoints: store }))
      .outcome,
    "needs_user",
  );
  assert.equal(calls, 2);
});
