//! OpenAI prompt 模板。

use crate::types::{
    ChatMessage, OpenAiSelectionExplainInput, OpenAiSessionChatInput, ResponseLanguageStrategy,
};

/// 构建会话上下文问答消息。
pub fn build_session_chat_messages(input: &OpenAiSessionChatInput) -> Vec<ChatMessage> {
    let context = &input.context;
    let session_kind = &context.session_kind;
    let host = context.host.as_deref().unwrap_or("-");
    let username = context.username.as_deref().unwrap_or("-");
    let platform = context.platform.as_deref().unwrap_or("-");
    let shell_name = context.shell_name.as_deref().unwrap_or("-");
    let resource_status = context.resource_monitor_status.as_deref().unwrap_or("-");
    let host_key_status = context.host_key_status.as_deref().unwrap_or("-");
    let recent_output = compact_recent_output(&context.recent_terminal_output, 1_000);
    let response_language =
        response_language_instruction(&input.response_language_strategy, &input.ui_language);
    let environment_override = environment_override_instruction(&input.messages);

    let system_prompt = format!(
        "You are FluxTerm's terminal AI assistant. Use only the current session context. Keep answers short, direct, and actionable. Avoid long tutorials. Prefer the minimum valid command or next step. If context is missing, say so. {}.\n\
Environment priority: {}.\n\
Format:\n\
- Answer: 1-3 short paragraphs or up to 4 bullets\n\
- Commands: only when useful, keep them minimal\n\
Session: {} | {} | state={}\n\
Target: host={} user={}\n\
Environment: platform={} shell={}\n\
Resource={} host_identity={}\n\
Recent output:\n{}",
        response_language,
        context.session_label,
        session_kind,
        context.session_state,
        host,
        username,
        platform,
        shell_name,
        environment_override,
        resource_status,
        host_key_status,
        recent_output
    );

    let mut messages = Vec::with_capacity(input.messages.len() + 1);
    messages.push(ChatMessage {
        role: "system".to_string(),
        content: system_prompt,
    });
    messages.extend(input.messages.clone());
    messages
}

/// 构建终端选中文本解释消息。
pub fn build_selection_explain_messages(input: &OpenAiSelectionExplainInput) -> Vec<ChatMessage> {
    let context = &input.context;
    let session_kind = &context.session_kind;
    let host = context.host.as_deref().unwrap_or("-");
    let username = context.username.as_deref().unwrap_or("-");
    let platform = context.platform.as_deref().unwrap_or("-");
    let shell_name = context.shell_name.as_deref().unwrap_or("-");
    let resource_status = context.resource_monitor_status.as_deref().unwrap_or("-");
    let host_key_status = context.host_key_status.as_deref().unwrap_or("-");
    let recent_output = compact_recent_output(&context.recent_terminal_output, 500);
    let response_language =
        response_language_instruction(&input.response_language_strategy, &input.ui_language);

    vec![
        ChatMessage {
            role: "system".to_string(),
            content: format!(
                "You are FluxTerm's terminal AI assistant. Explain the selected terminal text with the current session context. Keep it brief. Do not restate the full selection. Prefer commands valid for the current platform and shell. {}.\n\
Format:\n\
Conclusion: one sentence\n\
Cause: one or two short points\n\
Next step: one or two concrete commands or actions\n\
Session: {} | {} | state={}\n\
Target: host={} user={}\n\
Environment: platform={} shell={}\n\
Resource={} host_identity={}\n\
Recent output:\n{}",
                response_language,
                context.session_label,
                session_kind,
                context.session_state,
                host,
                username,
                platform,
                shell_name,
                resource_status,
                host_key_status,
                recent_output
            ),
        },
        ChatMessage {
            role: "user".to_string(),
            content: format!("Selected terminal text:\n{}", input.selection_text),
        },
    ]
}

fn response_language_instruction(strategy: &ResponseLanguageStrategy, ui_language: &str) -> String {
    match strategy {
        ResponseLanguageStrategy::FollowUi => {
            format!("Respond in {}", ui_language_name(ui_language))
        }
        ResponseLanguageStrategy::FollowUserInput => {
            format!(
                "Respond in the same language as the latest user message. If the user message language is unclear, respond in {}",
                ui_language_name(ui_language)
            )
        }
    }
}

fn environment_override_instruction(messages: &[ChatMessage]) -> &'static str {
    let latest_user_message = messages
        .iter()
        .rev()
        .find(|message| message.role == "user")
        .map(|message| message.content.as_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if contains_explicit_environment(&latest_user_message) {
        "If the latest user message explicitly names a target environment such as Linux, Windows, PowerShell, bash, Ubuntu, macOS, or cmd, follow that named environment first"
    } else {
        "Prefer the current session environment"
    }
}

fn contains_explicit_environment(message: &str) -> bool {
    const KEYWORDS: &[&str] = &[
        "linux",
        "ubuntu",
        "debian",
        "centos",
        "redhat",
        "rhel",
        "alpine",
        "macos",
        "windows",
        "powershell",
        "pwsh",
        "cmd",
        "bash",
        "zsh",
        "fish",
        "wsl",
    ];

    KEYWORDS.iter().any(|keyword| message.contains(keyword))
}

fn ui_language_name(value: &str) -> &'static str {
    match value {
        "zh" => "Simplified Chinese",
        "en" => "English",
        _ => "the current UI language",
    }
}

fn compact_recent_output(items: &[String], max_chars: usize) -> String {
    if items.is_empty() {
        return "-".to_string();
    }

    let mut ordered = items.join("\n");
    if ordered.chars().count() <= max_chars {
        return ordered;
    }
    ordered = ordered.chars().take(max_chars).collect::<String>();
    format!("{ordered}...")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::SessionContextSnapshot;

    #[test]
    fn session_chat_prompt_contains_context() {
        let input = OpenAiSessionChatInput {
            context: SessionContextSnapshot {
                session_id: "s1".to_string(),
                session_label: "alpha".to_string(),
                session_kind: "ssh".to_string(),
                host: Some("example.com".to_string()),
                username: Some("demo".to_string()),
                platform: Some("linux".to_string()),
                shell_name: Some("bash".to_string()),
                session_state: "connected".to_string(),
                resource_monitor_status: Some("ready".to_string()),
                host_key_status: Some("trusted".to_string()),
                recent_terminal_output: vec!["uname -a".to_string()],
            },
            response_language_strategy: ResponseLanguageStrategy::FollowUserInput,
            ui_language: "zh".to_string(),
            messages: vec![ChatMessage {
                role: "user".to_string(),
                content: "当前系统是什么？".to_string(),
            }],
        };

        let messages = build_session_chat_messages(&input);
        assert_eq!(messages[0].role, "system");
        assert!(messages[0].content.contains("example.com"));
        assert!(messages[0].content.contains("uname -a"));
        assert!(messages[0].content.contains("latest user message"));
        assert!(messages[0].content.contains("Simplified Chinese"));
        assert!(
            messages[0]
                .content
                .contains("Prefer the current session environment")
        );
    }

    #[test]
    fn selection_prompt_contains_selection_text() {
        let input = OpenAiSelectionExplainInput {
            context: SessionContextSnapshot {
                session_id: "s1".to_string(),
                session_label: "alpha".to_string(),
                session_kind: "local".to_string(),
                host: Some("example.com".to_string()),
                username: Some("demo".to_string()),
                platform: Some("windows".to_string()),
                shell_name: Some("powershell".to_string()),
                session_state: "connected".to_string(),
                resource_monitor_status: Some("ready".to_string()),
                host_key_status: Some("trusted".to_string()),
                recent_terminal_output: vec!["tail -f app.log".to_string()],
            },
            response_language_strategy: ResponseLanguageStrategy::FollowUi,
            ui_language: "en".to_string(),
            selection_text: "error: permission denied".to_string(),
        };

        let messages = build_selection_explain_messages(&input);

        assert_eq!(messages[0].role, "system");
        assert!(messages[0].content.contains("powershell"));
        assert!(messages[0].content.contains("Respond in English"));
        assert!(messages[1].content.contains("permission denied"));
    }

    #[test]
    fn session_chat_prompt_prefers_explicit_user_environment() {
        let input = OpenAiSessionChatInput {
            context: SessionContextSnapshot {
                session_id: "s1".to_string(),
                session_label: "local".to_string(),
                session_kind: "local".to_string(),
                host: None,
                username: None,
                platform: Some("windows".to_string()),
                shell_name: Some("powershell".to_string()),
                session_state: "connected".to_string(),
                resource_monitor_status: Some("ready".to_string()),
                host_key_status: None,
                recent_terminal_output: vec!["PS C:\\>".to_string()],
            },
            response_language_strategy: ResponseLanguageStrategy::FollowUserInput,
            ui_language: "zh".to_string(),
            messages: vec![ChatMessage {
                role: "user".to_string(),
                content: "Linux 下怎么查看磁盘分区？".to_string(),
            }],
        };

        let messages = build_session_chat_messages(&input);

        assert!(
            messages[0]
                .content
                .contains("follow that named environment first")
        );
    }
}
