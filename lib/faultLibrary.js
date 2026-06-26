'use strict';

// Each fault has a deterministic id and maps to one or more TS_TOPICS / TS_EXAMS.
// Customer scenarios are written in non-technical language — the caller does not
// know VMware terminology. Hints escalate from gentle nudge to full solution.

const FAULTS = [
  {
    id: 'vsphere-net-portgroup-mismatch',
    topic: 'vsphere-networking',
    difficulty: 'medium',
    examObjectives: ['VCP-DCV'],
    customer: {
      callerName: 'Jordan P.',
      company: 'Acme Labs',
      message: "Hi, I moved one of my virtual machines to a different host — I think it's called vMotion? — and now the machine seems to have disappeared from the network. It was working fine before. I can still see it in the list but it's offline.",
      clue: "Actually, now that you mention it — I did rename a few of the network labels last week to tidy things up. I only changed them on the new host though, I didn't think that would matter."
    },
    faultDescription: "Port group name mismatch between ESXi hosts. After vMotion, the VM's NIC references a port group name that does not exist on the destination host. The VM boots but has no network connectivity.",
    fixSteps: [
      "In vCenter, navigate to the destination host → Configure → Networking → Virtual switches.",
      "Compare port group names against the source host — look for any name differences.",
      "Either rename the mismatched port group to match exactly, or edit the VM NIC settings post-migration to point to the correct port group.",
      "If using a Distributed Virtual Switch, ensure all hosts are member hosts of the same DVS."
    ],
    objectives: "Understand that vMotion requires identical port group names (or DVS) across hosts. Standard vSwitch port groups are host-local — a rename on one host does not propagate.",
    hints: [
      "The VM was working on the source host and broke immediately after moving. What changed between the source and destination that could affect networking?",
      "vMotion moves the VM's configuration, including which port group its NIC is connected to. Check whether that port group name actually exists on the destination host.",
      "On the destination host, go to Configure → Networking. Look at the port group names carefully — even a single character difference (capitalisation, space, hyphen) will cause the NIC to connect to nothing.",
      "The VM's NIC is likely showing as 'Not connected' or connected to a port group that has no uplinks. Find the mismatched port group name and either correct it on the host or reassign the VM NIC.",
      "Fix: rename the port group on the destination host to exactly match the source host, then check VM connectivity. Long-term fix: migrate to a Distributed Virtual Switch so port groups are consistent across all hosts automatically."
    ]
  },
  {
    id: 'dns-vcenter-ptr-missing',
    topic: 'dns-ntp',
    difficulty: 'easy',
    examObjectives: ['VCP-DCV'],
    customer: {
      callerName: 'Sam R.',
      company: 'HomeLab Ltd',
      message: "I can connect to vCenter using the IP address but whenever I try to use the proper hostname it just times out or gives me a certificate error. I checked and the server is definitely running.",
      clue: "I set up DNS by hand — I added an A record for the vCenter hostname but I wasn't sure if I needed anything else. I didn't set up anything on a separate DNS server, just on the Windows domain controller."
    },
    faultDescription: "Missing reverse DNS (PTR) record for vCenter. vCenter requires both an A record and a PTR record. The hostname resolves to the IP but the reverse lookup fails. Several internal vCenter services validate their own identity by doing a reverse lookup — when this fails, services refuse to start or certificates become untrusted.",
    fixSteps: [
      "On the DNS server (usually the domain controller), open DNS Manager.",
      "Expand 'Reverse Lookup Zones' and confirm a zone exists for the vCenter subnet.",
      "If no reverse zone exists, create one: right-click Reverse Lookup Zones → New Zone → enter the network address.",
      "Add a PTR record for vCenter: right-click the zone → New Pointer (PTR) → enter the last octet of the IP and the FQDN.",
      "From the vCenter VM console, run `nslookup <vcenter-ip>` — it should return the FQDN. Also confirm `nslookup <vcenter-fqdn>` returns the IP."
    ],
    objectives: "vCenter requires forward (A) and reverse (PTR) DNS records. A missing PTR record is one of the most common causes of certificate validation failures and service startup errors in a freshly deployed lab.",
    hints: [
      "The IP address works but the hostname doesn't — the problem is somewhere between the hostname and the IP address. Which service handles that translation?",
      "DNS resolves names to IPs, but services often also check the reverse: given an IP, what name does it belong to? This is a PTR record. Try running `nslookup <vcenter-ip>` from a machine on the same network.",
      "Check if a reverse lookup zone exists for the vCenter subnet in your DNS server. If the zone is missing, the PTR record cannot exist.",
      "Create a reverse lookup zone and add a PTR record for vCenter's IP address pointing back to its FQDN. Confirm both `nslookup vcenter.yourdomain.local` and `nslookup <ip>` return the correct results.",
      "Fix: in DNS Manager, create the reverse lookup zone for the vCenter subnet (e.g. 192.168.10.x → zone '10.168.192.in-addr.arpa'), then add a PTR record for the vCenter IP. Restart vCenter services if they are already in a failed state."
    ]
  },
  {
    id: 'vsan-vmkernel-missing',
    topic: 'vsan',
    difficulty: 'medium',
    examObjectives: ['VCP-DCV', 'VCAP-DCV'],
    customer: {
      callerName: 'Alex T.',
      company: 'NestedCloud Co',
      message: "The health dashboard is showing amber warnings on the storage side and a couple of my VMs are running really slowly — like they're struggling to read data. Everything looked fine yesterday.",
      clue: "I did reconfigure the networking on one of the hosts last night — I was tidying up some IP addresses. I may have accidentally removed or changed something on that host."
    },
    faultDescription: "vSAN vmkernel adapter missing or bound to the wrong port group on one host. vSAN requires a dedicated vmkernel NIC tagged for vSAN traffic. If it is removed or its tag is cleared, the host cannot participate in vSAN I/O, causing objects to become non-compliant and VMs on that host to see degraded storage performance.",
    fixSteps: [
      "In vCenter, go to the affected host → Configure → Networking → VMkernel adapters.",
      "Check whether a vmkernel adapter is tagged for vSAN traffic (the 'vSAN' checkbox must be ticked).",
      "If the adapter is present but the tag is missing, edit it and enable 'vSAN' under the Services section.",
      "If the adapter is missing, add a new VMkernel adapter on the vSAN port group and tick the vSAN service.",
      "After fixing, go to Cluster → Configure → vSAN → Health and run 'Retest' — the network partition warnings should clear within a few minutes."
    ],
    objectives: "vSAN requires at least one vmkernel adapter with the vSAN traffic type enabled on every host in the cluster. Removing or misconfiguring this adapter causes vSAN objects to become non-compliant and is a common mistake after network reconfiguration.",
    hints: [
      "The health warnings appeared after a network change on one host. vSAN uses dedicated network interfaces between hosts — what might have changed that could affect this?",
      "Navigate to the affected host in vCenter and look at its VMkernel adapters. vSAN requires one vmkernel adapter to be specifically tagged for vSAN traffic. Is that tag still present?",
      "Go to Host → Configure → Networking → VMkernel Adapters. Look for a vmk interface tagged 'vSAN'. If all adapters show only 'Management' or 'vMotion', the vSAN tag has been removed.",
      "Edit the vmkernel adapter that should carry vSAN traffic and ensure the 'vSAN' service checkbox is ticked. Alternatively, if the adapter was deleted, add a new one on the vSAN port group with the vSAN service enabled.",
      "Fix: select the vmkernel adapter → Edit → Services → tick 'vSAN' → OK. Then run a vSAN health recheck from Cluster → Configure → vSAN → Health. Objects should resync and the amber warnings should clear."
    ]
  },
  {
    id: 'nsx-t0-uplink-vlan-wrong',
    topic: 'nsx-routing',
    difficulty: 'hard',
    examObjectives: ['VCP-NV', 'VCAP-NV'],
    customer: {
      callerName: 'Morgan K.',
      company: 'VirtNet Solutions',
      message: "The VMs can ping each other and they can ping the router, but nothing can get out to the internet. It's been like this since I finished building the NSX layer. The underlying network team say their side looks fine.",
      clue: "I'll be honest, the NSX setup was quite involved. I followed a guide but I may have mixed up a VLAN number somewhere. The uplink is on a specific VLAN on our core switch."
    },
    faultDescription: "T0 Gateway uplink segment is configured with the wrong VLAN. The T0 uplink segment connects to the physical network via a VLAN-backed segment. If the VLAN ID does not match what is configured on the physical switch, the T0 cannot communicate with the upstream router, so BGP (if used) never establishes and no default route is installed.",
    fixSteps: [
      "In NSX Manager, go to Networking → Segments and find the uplink segment used by the T0 gateway.",
      "Note the VLAN ID configured on that segment.",
      "Confirm with the network team (or check the physical switch config) what VLAN is trunked to the ESXi host's uplink vmnic.",
      "If the VLAN IDs differ, edit the NSX segment and correct the VLAN ID.",
      "If BGP is configured, go to T0 → BGP → check the neighbour state. After correcting the VLAN, the BGP session should establish and the default route should appear.",
      "Test from a VM: `ping 8.8.8.8` — if routing is restored, north-south traffic is working."
    ],
    objectives: "The T0 Gateway uplink segment must use a VLAN ID that matches the physical switch trunking configuration. A VLAN mismatch at the T0 uplink is a common cause of 'VMs can reach each other but not the internet' in newly built NSX environments.",
    hints: [
      "East-west traffic works (VMs reach each other) but north-south fails (can't reach outside). This means NSX overlay is working — the problem is specifically at the boundary between the virtual and physical network.",
      "The T0 Gateway handles north-south routing. It connects to the physical network via an 'uplink segment'. A segment needs a VLAN ID to tag traffic correctly for the physical switch. What VLAN ID is on your T0 uplink segment?",
      "In NSX Manager, go to Networking → Segments. Find the uplink segment (it will be a VLAN-backed segment, not an overlay segment). Note its VLAN ID and compare it against what your physical switch expects on that trunk port.",
      "The VLAN ID on the NSX uplink segment must exactly match the VLAN that the physical switch has trunked to the ESXi host's uplink. If they differ by even one digit, no frames cross the boundary. Also check whether BGP is configured — if so, the BGP session state will show whether the T0 can reach the upstream peer.",
      "Fix: in NSX Manager, edit the uplink segment and correct the VLAN ID to match the physical switch trunk VLAN. If BGP is in use, verify the peer comes up under T0 → BGP → Neighbours. Test with a ping to an external IP from a test VM."
    ]
  },
  {
    id: 'cert-machine-ssl-expired',
    topic: 'certificate-management',
    difficulty: 'medium',
    examObjectives: ['VCP-DCV', 'VCAP-DCV'],
    customer: {
      callerName: 'Riley J.',
      company: 'CertLab Ops',
      message: "When I open vCenter in the browser I'm getting a big red security warning and some of the things in the interface seem to be broken or missing. I haven't changed anything recently — it just started this morning.",
      clue: "The lab was built about two years ago. I don't think I've ever renewed any certificates. Is that something that expires?"
    },
    faultDescription: "vCenter Machine SSL certificate has expired. The default self-signed Machine SSL certificate issued at deployment time has a 2-year validity period. After expiry, browser HTTPS connections show certificate errors and internal services that validate TLS fail, causing the vSphere Client to partially or fully break.",
    fixSteps: [
      "SSH into the vCenter appliance as root.",
      "Run `/usr/lib/vmware-vmafd/bin/vecs-cli entry list --store MACHINE_SSL_CERT` to see the current certificate and its expiry.",
      "Use the Certificate Manager tool: `/usr/lib/vmware-vmca/bin/certificate-manager`.",
      "Choose option 3 (Replace Machine SSL certificate with VMCA Certificate) to issue a new certificate from the built-in VMCA.",
      "Follow the prompts — you'll need to provide the vCenter FQDN, IP, and SSO administrator password.",
      "After replacement, restart vCenter services: `service-control --restart --all`.",
      "Clear your browser cache and reconnect — the new certificate will be valid for another 2 years."
    ],
    objectives: "vCenter self-signed certificates expire after 2 years by default. Certificate expiry is a common operational gap in home labs. The Certificate Manager tool (/usr/lib/vmware-vmca/bin/certificate-manager) handles replacement without a full reinstall.",
    hints: [
      "The problem appeared suddenly with no configuration change. Things that 'just happen' over time without intervention are worth considering — certificates, passwords, licence keys.",
      "Open the browser's certificate details for the vCenter page (padlock → Certificate). Look at the 'Valid until' date. If it is in the past, the certificate has expired.",
      "Self-signed vCenter certificates expire after 2 years. SSH into the vCenter appliance and check the certificate expiry with the vecs-cli tool: `/usr/lib/vmware-vmafd/bin/vecs-cli entry list --store MACHINE_SSL_CERT`.",
      "The Certificate Manager utility at `/usr/lib/vmware-vmca/bin/certificate-manager` can replace the Machine SSL certificate with a fresh one from the built-in VMCA (option 3). You will need the vCenter FQDN, IP, and SSO admin password.",
      "Fix: SSH to vCenter → run certificate-manager → choose option 3 → follow prompts → run `service-control --restart --all`. Certificate replacement takes 5–10 minutes. After restart, clear your browser cache and reconnect."
    ]
  },
  {
    id: 'bgp-wrong-as-number',
    topic: 'bgp',
    difficulty: 'hard',
    examObjectives: ['VCP-NV', 'VCAP-NV'],
    customer: {
      callerName: 'Casey D.',
      company: 'RouteTest Inc',
      message: "The virtual router and the upstream device seem to be able to see each other — I can ping between them — but VMs behind the router still can't reach outside the lab. The upstream team say their BGP session shows as idle.",
      clue: "I configured the BGP settings myself. I'm not a network specialist — I set the AS numbers but I may have mixed them up. The upstream device is using AS 65001."
    },
    faultDescription: "BGP neighbour misconfigured with wrong remote AS number. The local router is configured to expect the upstream peer's AS number, but the value entered is incorrect. BGP sessions use AS numbers to authenticate peering — if the remote AS does not match what the peer announces, the session stays in Idle/Active state and no routes are exchanged.",
    fixSteps: [
      "Log into the VyOS router (SSH or console) and run `show bgp summary` to see the current BGP neighbour state.",
      "Note the 'AS' column for the upstream neighbour — this is what VyOS thinks the remote AS is.",
      "Confirm the upstream peer's actual AS number with the network team (or from their config).",
      "If the AS numbers differ, edit the VyOS BGP config: `configure` → `set protocols bgp neighbor <peer-ip> remote-as <correct-as>`.",
      "Commit and run `show bgp summary` again — the session should move to Established within 30 seconds.",
      "Verify routes with `show ip route bgp` — you should see a default route or the upstream prefix."
    ],
    objectives: "BGP peering requires both sides to agree on each other's AS numbers. A common misconfiguration is swapping local-AS and remote-AS, or entering the wrong remote-AS value. `show bgp summary` shows the session state and configured remote AS on VyOS.",
    hints: [
      "The two devices can reach each other (ping works) so there is no L2/L3 connectivity problem. BGP is a separate protocol that runs on top of IP — something specific to BGP must be misconfigured.",
      "BGP sessions can fail to establish even when the IP connectivity is perfect. The most common causes are: wrong remote AS number, wrong peer IP, or TCP port 179 being blocked. Run `show bgp summary` on the VyOS router — what state is the neighbour in?",
      "BGP uses AS numbers to identify each party. The local router needs to know the correct AS number of its peer. If the AS number is wrong, the session stays in 'Idle' or 'Active'. Run `show bgp summary` and check the 'AS' column for the upstream neighbour against what the upstream peer is actually using.",
      "The upstream peer says it's using AS 65001. On VyOS, run `show bgp summary` and check what remote-AS is configured for that neighbour. If it shows anything other than 65001, that's the fault. Fix with: `configure` → `set protocols bgp neighbor <peer-ip> remote-as 65001` → `commit`.",
      "Fix: `configure` → `set protocols bgp neighbor <upstream-ip> remote-as 65001` → `commit` → `exit`. Run `show bgp summary` and confirm the state moves to Established. Then `show ip route bgp` to confirm the default or upstream route has been received."
    ]
  },
  {
    id: 'nsx-dfw-default-deny',
    topic: 'nsx-dfw',
    difficulty: 'medium',
    examObjectives: ['VCP-NV'],
    customer: {
      callerName: 'Drew H.',
      company: 'MicroSeg Labs',
      message: "Two VMs that have been talking to each other for weeks have suddenly stopped communicating. Nothing has changed on the VMs themselves — no OS updates, no IP changes. I can see both VMs are running fine.",
      clue: "Actually, I was tidying up the security policy in NSX yesterday. I deleted a few rules that I thought were unused. Could that be related?"
    },
    faultDescription: "An NSX Distributed Firewall rule that was explicitly allowing east-west traffic between the VMs was deleted, leaving them subject to a higher-level deny rule or the default policy. In NSX DFW, traffic is denied if no matching allow rule exists and the default rule (or a parent policy) is set to drop.",
    fixSteps: [
      "In NSX Manager, navigate to Security → Distributed Firewall.",
      "Look at the policy sections — check the Default Layer-3 Policy action (it may be 'Drop').",
      "Review any policy that applies to the affected VMs' security groups or segments — look for missing or overly broad deny rules.",
      "Add an explicit allow rule between the two affected VMs or their containing groups: Source = VM-A group, Destination = VM-B group, Service = Any (or specific), Action = Allow.",
      "Confirm the new rule appears above any deny rules in the policy stack.",
      "Test connectivity between the VMs — it should restore immediately when the rule is published."
    ],
    objectives: "NSX DFW is a stateful, software-defined firewall evaluated at the vNIC. Traffic between VMs is denied if no matching allow rule exists. Deleting an 'allow' rule unintentionally exposes VMs to a parent deny policy, which is a common NSX operational mistake.",
    hints: [
      "The VMs haven't changed, but security policy was modified yesterday. East-west traffic in NSX goes through the Distributed Firewall on every vNIC. A deleted rule could affect what traffic is allowed.",
      "Check the NSX Distributed Firewall rules that apply to these two VMs. In NSX Manager, go to Security → Distributed Firewall and look for rules that reference the VMs' groups or segments. Is there an allow rule between them?",
      "In NSX DFW, traffic is allowed only if an explicit allow rule matches. If the rule was deleted, the traffic hits the next matching rule — which might be a deny. Look at the Default Layer-3 Section — what is the default action?",
      "The deleted rule was likely an explicit allow between these VMs or their groups. To confirm, check the DFW 'Monitor' view: Security → Firewall → View Firewall Logs or use Flow Monitoring to see whether the traffic is being dropped and by which rule.",
      "Fix: create a new DFW rule — Source: [VM-A or its group], Destination: [VM-B or its group], Service: Any, Action: Allow — and place it above any deny rules in the relevant policy section. Publish the changes. Connectivity should restore immediately."
    ]
  },
  {
    id: 'vcf-bringup-ntp-unreachable',
    topic: 'vcf-bringup',
    difficulty: 'hard',
    examObjectives: ['VCF 3V0-25.25'],
    customer: {
      callerName: 'Pat L.',
      company: 'Foundation Labs',
      message: "I'm trying to run the initial setup for the platform and it keeps failing the validation checks before I even get started. The error message mentions time synchronisation but I don't understand what that means.",
      clue: "I configured the NTP server IP myself in the setup form. I copied it from a document but there were two IP addresses in there — I may have picked the wrong one. The actual NTP server is at 192.168.1.5."
    },
    faultDescription: "VCF bring-up validation fails because the NTP server IP configured in the bring-up spec is unreachable or returns no NTP response. SDDC Manager validates NTP reachability before proceeding — all components (ESXi hosts, SDDC Manager, vCenter) must be able to reach the NTP server and synchronise time before bring-up continues.",
    fixSteps: [
      "On the management ESXi host, open a console and run `ntpq -p` or use esxcli: `esxcli system ntp get` to see the currently configured NTP server.",
      "From the ESXi console, test reachability: `nc -uz 192.168.1.5 123` or `esxcli network diag ping -H 192.168.1.5`.",
      "If the correct NTP server is 192.168.1.5, update the ESXi host NTP config: `esxcli system ntp set -s 192.168.1.5` → `esxcli system ntp set -e true`.",
      "If running in VCF bring-up context, the NTP IP in the bring-up JSON/spec must also be updated to the correct value.",
      "Restart NTP service: `esxcli system ntp set -e false && esxcli system ntp set -e true`.",
      "Re-run the VCF bring-up pre-validation checks — the NTP validation should pass."
    ],
    objectives: "VCF bring-up performs strict pre-validation including NTP reachability. All hosts must reach the same NTP source. A wrong NTP IP in the bring-up spec is a frequent mistake when adapting templates or copying values across environments.",
    hints: [
      "VCF bring-up validation runs before anything is deployed — if it fails, nothing proceeds. The error is about time synchronisation. What provides time synchronisation in a network?",
      "NTP (Network Time Protocol) synchronises clocks across all devices. VCF requires all components to use the same NTP source. The bring-up validation actually tests whether the NTP server is reachable and responding. Can the ESXi hosts ping or reach the configured NTP server IP?",
      "From an ESXi host console, test whether the NTP server is reachable: `esxcli network diag ping -H <ntp-ip>`. If the ping fails or there is no response on UDP port 123, the NTP server IP is wrong or blocked.",
      "The correct NTP server is 192.168.1.5. Check the current NTP configuration on the ESXi hosts with `esxcli system ntp get`. If the IP is different, update it with `esxcli system ntp set -s 192.168.1.5`. Also update the bring-up spec JSON if it contains the NTP IP.",
      "Fix: `esxcli system ntp set -s 192.168.1.5` on each host, restart the NTP service, verify time sync with `esxcli system ntp get`, then re-run VCF pre-validation. Ensure the bring-up spec file also contains the correct NTP IP — the spec is validated independently of the host config."
    ]
  },
  {
    id: 'storage-nfs-vmk-mtu-mismatch',
    topic: 'storage',
    difficulty: 'medium',
    examObjectives: ['VCP-DCV'],
    customer: {
      callerName: 'Quinn A.',
      company: 'StorageOps Ltd',
      message: "One of my servers is showing the shared storage folder as disconnected. The other servers can see it fine. The affected server can still run VMs from its local disk, but it can't access the shared area.",
      clue: "I was changing some network settings on that host recently — I think I adjusted the MTU on one of the virtual network cards. I changed it to 9000 to try to improve performance."
    },
    faultDescription: "MTU mismatch on the NFS vmkernel adapter. The vmkernel interface used for NFS storage traffic was set to Jumbo Frames (MTU 9000) but the upstream switch or the NFS server interface is still at standard MTU (1500). Fragmentation or frame drops cause the NFS mount to fail or become unstable.",
    fixSteps: [
      "In vCenter, go to the affected host → Configure → Networking → VMkernel Adapters.",
      "Find the vmkernel adapter used for NFS (usually on the storage VLAN/port group).",
      "Check its MTU setting — if it shows 9000 and the NFS server or switch is configured for 1500, this is the mismatch.",
      "Either: (a) revert the vmkernel MTU to 1500 to match the rest of the path, or (b) set all components in the path (vmk, virtual switch, physical switch, NFS server) to 9000.",
      "Option (a) is faster for a lab: edit the vmkernel → MTU → change to 1500.",
      "After saving, the NFS datastore should reconnect automatically within 30–60 seconds. If not, right-click the datastore → Unmount → Mount."
    ],
    objectives: "Jumbo frames (MTU 9000) require end-to-end consistency — every hop in the path must support the same MTU. A partial Jumbo Frame change breaks NFS and iSCSI datastores. In a lab, reverting to MTU 1500 is often the fastest fix.",
    hints: [
      "Only one host is affected — the others are fine. That points to something configured differently on that specific host rather than a shared infrastructure problem. What was recently changed on that host?",
      "A change to a network adapter's MTU was made. NFS uses TCP/IP over a vmkernel adapter. If the MTU on that adapter doesn't match the rest of the network path (physical switch, NFS server), packets may be dropped or fragmented, causing the NFS mount to fail.",
      "Go to the affected host → Configure → Networking → VMkernel Adapters. Find the adapter used for NFS traffic and check its MTU. Then compare that value against what the physical switch and NFS server are configured with. Even one mismatch in the path breaks Jumbo Frames.",
      "The vmkernel MTU was changed to 9000 (Jumbo Frames). If the rest of the path (physical switch, NFS server) is still at 1500, frames above 1500 bytes will be dropped. The fastest fix is to revert the vmkernel MTU to 1500. Alternatively, enable Jumbo Frames on every device in the path.",
      "Fix: edit the vmkernel adapter → change MTU from 9000 to 1500 → save. The NFS datastore should reconnect within a minute. If not, right-click the datastore in vCenter → Unmount → then Mount to force a reconnection attempt."
    ]
  },
  {
    id: 'vsphere-net-promiscuous-dhcp',
    topic: 'vsphere-networking',
    difficulty: 'easy',
    examObjectives: ['VCP-DCV'],
    customer: {
      callerName: 'Avery S.',
      company: 'DevNet Labs',
      message: "All the new VMs I'm deploying are getting stuck with a 169.254 address — I know that means they're not getting a proper IP from the DHCP server. Existing VMs are fine, only new ones have the problem. The DHCP server is running and healthy.",
      clue: "I rebuilt the virtual switch last week — I had to recreate the port groups from scratch. I may have missed a setting. The DHCP server is actually a VM inside the lab itself."
    },
    faultDescription: "Promiscuous mode is disabled on the port group where nested VMs (or the DHCP broadcast traffic) needs to pass. In a nested virtualisation lab, the DHCP discover broadcast from a nested VM must pass through the parent vSwitch. If promiscuous mode is not enabled on the relevant port group, the broadcast frames are filtered and the nested VM never receives a DHCP offer.",
    fixSteps: [
      "In vCenter or the ESXi host client, navigate to the physical host's virtual switch configuration.",
      "Find the port group that carries the management or VM network traffic for the affected VMs.",
      "Edit the port group security policy: set 'Promiscuous Mode' to Accept.",
      "Also confirm 'Forged Transmits' and 'MAC Address Changes' are set to Accept — all three are required for nested networking.",
      "The change takes effect immediately. New VMs should receive DHCP addresses within 30 seconds of having their NIC connected."
    ],
    objectives: "Nested virtualisation requires promiscuous mode, forged transmits, and MAC address changes set to Accept on the parent vSwitch port group. These settings are deliberately disabled by default and must be explicitly enabled for nested VM networking to work. Forgetting them when recreating port groups is a very common lab mistake.",
    hints: [
      "Existing VMs work but new ones don't — and the virtual switch was recently rebuilt. DHCP uses broadcast packets. Something about the port group configuration might be filtering those broadcasts.",
      "In nested virtualisation labs, VMs running inside nested ESXi hosts send traffic with MAC addresses that don't match the outer VM's MAC. The parent vSwitch drops those frames by default unless specific security settings are enabled. Look at the port group's security policy.",
      "Check the port group security settings on the physical vSwitch: Promiscuous Mode, Forged Transmits, and MAC Address Changes. For nested labs, all three must be set to 'Accept'. If you recreated the port group from scratch, these default to 'Reject'.",
      "The three port group security settings — Promiscuous Mode, Forged Transmits, and MAC Address Changes — must all be set to 'Accept' on any port group carrying traffic for nested VMs or for a DHCP server inside the nested environment. Check each one and change any 'Reject' to 'Accept'.",
      "Fix: in the vSwitch port group settings (or DVS port group → Edit → Security), set Promiscuous Mode = Accept, Forged Transmits = Accept, MAC Address Changes = Accept. These settings apply immediately. Test by deploying a new VM — it should get a DHCP address within about 30 seconds."
    ]
  }
];

/**
 * Select faults matching topic and difficulty filters.
 * If no filters match, returns all faults for that difficulty (then all).
 * Always returns at least one fault.
 */
function selectFault(topics = [], examObjectives = [], difficulty = 'medium') {
  const diffOrder = { easy: 0, medium: 1, hard: 2 };
  const targetDiff = difficulty in diffOrder ? difficulty : 'medium';

  let pool = FAULTS;

  // Filter by topic
  if (topics.length > 0) {
    const topicMatch = pool.filter(f => topics.includes(f.topic));
    if (topicMatch.length > 0) pool = topicMatch;
  }

  // Filter by exam objectives
  if (examObjectives.length > 0) {
    const examMatch = pool.filter(f => f.examObjectives.some(e => examObjectives.includes(e)));
    if (examMatch.length > 0) pool = examMatch;
  }

  // Filter by difficulty
  const diffMatch = pool.filter(f => f.difficulty === targetDiff);
  if (diffMatch.length > 0) pool = diffMatch;

  // Pick pseudo-randomly (deterministic within a second to allow testing)
  const idx = Math.floor(Date.now() / 1000) % pool.length;
  return pool[idx];
}

module.exports = { FAULTS, selectFault };
