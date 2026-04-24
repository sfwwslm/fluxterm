import type { IconType } from "react-icons";
import { FiServer } from "react-icons/fi";
import {
  SiAlmalinux,
  SiAlpinelinux,
  SiApache,
  SiArchlinux,
  SiCentos,
  SiCloudflare,
  SiDebian,
  SiVmware,
  SiDocker,
  SiElasticsearch,
  SiGitlab,
  SiGrafana,
  SiJenkins,
  SiKubernetes,
  SiLaravel,
  SiLinux,
  SiMongodb,
  SiMysql,
  SiSynology,
  SiTruenas,
  SiNginx,
  SiPostgresql,
  SiPrometheus,
  SiRabbitmq,
  SiUnraid,
  SiRedis,
  Si1Panel,
  SiKalilinux,
  SiKubuntu,
  SiLaragon,
  SiMariadb,
  SiNodedotjs,
  SiOllama,
  SiOpensuse,
  SiOpenvpn,
  SiRedhat,
  SiSteam,
  SiProxmox,
  SiUbuntu,
  SiWebmin,
  SiWordpress,
} from "react-icons/si";

/** SSH 会话图标注册项。 */
export type ProfileIconOption = {
  key: string;
  label: string;
  Icon: IconType;
};

/**
 * SSH 会话图标目录。
 * 修改这里的 key 集合时，需要同步更新后端 `profile.rs` 中的允许集合。
 */
export const PROFILE_ICON_OPTIONS: ProfileIconOption[] = [
  {
    key: "linux",
    label: "Linux",
    Icon: SiLinux,
  },
  {
    key: "ubuntu",
    label: "Ubuntu",
    Icon: SiUbuntu,
  },
  {
    key: "debian",
    label: "Debian",
    Icon: SiDebian,
  },
  {
    key: "proxmox",
    label: "Proxmox",
    Icon: SiProxmox,
  },
  {
    key: "vmware",
    label: "Vmware",
    Icon: SiVmware,
  },
  {
    key: "synology",
    label: "Synology",
    Icon: SiSynology,
  },
  {
    key: "truenas",
    label: "Truenas",
    Icon: SiTruenas,
  },
  {
    key: "unraid",
    label: "Unraid",
    Icon: SiUnraid,
  },
  {
    key: "steam",
    label: "Steam",
    Icon: SiSteam,
  },
  {
    key: "centos",
    label: "CentOS",
    Icon: SiCentos,
  },
  {
    key: "almalinux",
    label: "AlmaLinux",
    Icon: SiAlmalinux,
  },
  {
    key: "alpinelinux",
    label: "Alpine Linux",
    Icon: SiAlpinelinux,
  },
  {
    key: "archlinux",
    label: "Arch Linux",
    Icon: SiArchlinux,
  },
  {
    key: "kali",
    label: "Kali",
    Icon: SiKalilinux,
  },
  {
    key: "kubuntu",
    label: "Kubuntu",
    Icon: SiKubuntu,
  },
  {
    key: "opensuse",
    label: "openSUSE",
    Icon: SiOpensuse,
  },
  {
    key: "redhat",
    label: "Red Hat",
    Icon: SiRedhat,
  },
  {
    key: "1panel",
    label: "1Panel",
    Icon: Si1Panel,
  },
  {
    key: "docker",
    label: "Docker",
    Icon: SiDocker,
  },
  {
    key: "kubernetes",
    label: "Kubernetes",
    Icon: SiKubernetes,
  },
  {
    key: "nginx",
    label: "Nginx",
    Icon: SiNginx,
  },
  {
    key: "apache",
    label: "Apache",
    Icon: SiApache,
  },
  {
    key: "cloudflare",
    label: "Cloudflare",
    Icon: SiCloudflare,
  },
  {
    key: "mysql",
    label: "MySQL",
    Icon: SiMysql,
  },
  {
    key: "postgresql",
    label: "PostgreSQL",
    Icon: SiPostgresql,
  },
  {
    key: "mongodb",
    label: "MongoDB",
    Icon: SiMongodb,
  },
  {
    key: "redis",
    label: "Redis",
    Icon: SiRedis,
  },
  {
    key: "rabbitmq",
    label: "RabbitMQ",
    Icon: SiRabbitmq,
  },
  {
    key: "elasticsearch",
    label: "Elasticsearch",
    Icon: SiElasticsearch,
  },
  {
    key: "wordpress",
    label: "WordPress",
    Icon: SiWordpress,
  },
  {
    key: "laravel",
    label: "Laravel",
    Icon: SiLaravel,
  },
  {
    key: "grafana",
    label: "Grafana",
    Icon: SiGrafana,
  },
  {
    key: "prometheus",
    label: "Prometheus",
    Icon: SiPrometheus,
  },
  {
    key: "jenkins",
    label: "Jenkins",
    Icon: SiJenkins,
  },
  {
    key: "gitlab",
    label: "GitLab",
    Icon: SiGitlab,
  },
  {
    key: "laragon",
    label: "Laragon",
    Icon: SiLaragon,
  },
  {
    key: "mariadb",
    label: "MariaDB",
    Icon: SiMariadb,
  },
  {
    key: "nodedotjs",
    label: "Node.js",
    Icon: SiNodedotjs,
  },
  {
    key: "ollama",
    label: "Ollama",
    Icon: SiOllama,
  },
  {
    key: "openvpn",
    label: "OpenVPN",
    Icon: SiOpenvpn,
  },
  {
    key: "webmin",
    label: "Webmin",
    Icon: SiWebmin,
  },
];

const PROFILE_ICON_MAP = new Map(
  PROFILE_ICON_OPTIONS.map((item) => [item.key, item] as const),
);

/** 解析 SSH 会话图标组件，未命中时回退默认服务器图标。 */
export function resolveProfileIcon(
  iconKey: string | null | undefined,
): IconType {
  return PROFILE_ICON_MAP.get(iconKey ?? "")?.Icon ?? FiServer;
}
