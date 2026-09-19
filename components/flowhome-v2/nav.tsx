"use client";
import {usePathname} from 'next/navigation';
import {ArrowUpRight,House,BriefcaseBusiness,Wrench,FlaskConical} from 'lucide-react';
export const links=[['/live','居住服务',House],['/ops','运营台',BriefcaseBusiness],['/partners','服务商',Wrench],['/lab','研究台',FlaskConical]] as const;
export default function Navigation(){const path=usePathname();return <header className="v2-header"><a href="/" className="v2-logo"><span>栖</span><b>栖流<small>FLOWHOME</small></b></a><nav aria-label="产品入口"><a href="/" aria-current={path==='/'?'page':undefined} className={path==='/'?'active':''}>项目</a>{links.map(([href,label,Icon])=><a href={href} key={href} aria-current={path===href?'page':undefined} className={path===href?'active':''}><Icon size={15}/>{label}</a>)}</nav><a className="v2-version" href="/v1">V2 / 查看 V1 <ArrowUpRight size={13}/></a></header>}
