import React, { useMemo } from 'react';
import { UserRole } from '../types';
import { Code, PenTool, MessageSquare } from 'lucide-react';

interface RoutingPromptsProps {
    onSelect: (prompt: string) => void;
    disabled: boolean;
    refreshKey: number;
    role: UserRole;
}

const CODE_PROMPTS = [
    "Write a Python script to block a malicious IP on a PAN-OS firewall",
    "Generate Terraform code to deploy a VM-Series firewall in AWS",
    "Write a PowerShell script to query Cortex XDR endpoints",
    "Develop JavaScript code to parse Cortex XDR webhook JSON payloads",
    "Show me the Python code to authenticate with the Prisma Cloud API"
];

const WRITING_PROMPTS = [
    "Write a blog post about Zero Trust Architecture",
    "Draft an executive summary on the benefits of Cortex XDR",
    "Compose an email to the team about the new firewall upgrade",
    "Write a whitepaper introduction on cloud security posture management",
    "Create a customer-facing newsletter about SASE benefits"
];

const GENERAL_PROMPTS = [
    "Explain what a Zero Trust Network is in simple terms",
    "What are the main differences between Strata and Prisma?",
    "How does App-ID work in Palo Alto Networks firewalls?",
    "Summarize the key features of Cortex XSOAR",
    "What are the best practices for configuring GlobalProtect?"
];

export const RoutingPrompts: React.FC<RoutingPromptsProps> = ({ onSelect, disabled, refreshKey, role }) => {
    if (role !== 'developer') return null;
    
    const categories = useMemo(() => {
        const pickRandom = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
        return [
            {
                id: 'code',
                title: 'Code',
                icon: <Code size={16} className="text-teal-600" />,
                route: 'Routes to meta.llama3-8b-instruct-v1:0',
                text: pickRandom(CODE_PROMPTS)
            },
            {
                id: 'writing',
                title: 'Writing',
                icon: <PenTool size={16} className="text-teal-600" />,
                route: 'Routes to us.amazon.nova-pro-v1:0',
                text: pickRandom(WRITING_PROMPTS)
            },
            {
                id: 'general',
                title: 'General',
                icon: <MessageSquare size={16} className="text-teal-600" />,
                route: 'Routes to flash',
                text: pickRandom(GENERAL_PROMPTS)
            }
        ];
    }, [refreshKey]);

    return (
        <div className="max-w-4xl mx-auto w-full px-4 sm:px-6 pt-3">
            <div className="text-xs font-bold uppercase tracking-wider text-teal-600 mb-3">
                Smart Model Routing - Jev Integrated (Developer Only)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
                {categories.map((cat) => (
                    <button
                        key={cat.id}
                        onClick={() => onSelect(cat.text)}
                        disabled={disabled}
                        className="text-left p-3 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-100 hover:border-teal-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm group flex flex-col"
                    >
                        <div className="flex items-center space-x-1.5 mb-1">
                            {cat.icon}
                            <span className="font-semibold text-sm text-zinc-800 group-hover:text-teal-600">
                                {cat.title}
                            </span>
                        </div>
                        <div className="text-[10px] font-medium text-teal-600/70 mb-1.5 uppercase tracking-wide">
                            {cat.route}
                        </div>
                        <div className="text-xs line-clamp-2 text-zinc-500">
                            {cat.text}
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
};
