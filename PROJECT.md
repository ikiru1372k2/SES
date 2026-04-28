# SES — Smart Escalation System

SES audits Excel workbooks, flags problems, and makes sure the right
person sees them. Upload a workbook, the system checks it, issues are
routed to the manager who owns that area, and if no one acts in time
the issue escalates up the chain automatically.

## AI Pilot

The standout feature. Instead of waiting for a developer to add a new
check, an admin describes the rule in plain English — "flag any row
where the project end date is before the start date" — and the AI turns
it into a working audit rule. The admin previews it on a sample
workbook to see exactly which rows it would flag, then saves it. From
that moment on, the rule runs on every audit, side by side with the
built-in checks.

Every rule can be paused, resumed, or archived without losing it.
Nothing is saved until the admin previews it first. And every step is
logged, so you always know who added a rule, when, and why.

---

## Feature walk-through

Each section below has a screenshot from `docs/screenshots/` and a
short note on what the screen does.

<!--
  Add features here in order. Format:

    ### N. <Feature name>
    ![Caption](docs/screenshots/N_<slug>.png)
    Short note on what the screen does.
-->
