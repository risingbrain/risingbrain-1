import { Quote } from "lucide-react";
import { Avatar, Container, Eyebrow, Stars } from "./primitives";

type Review = {
  name: string;
  /** A handle or location — whatever the learner shared. */
  meta: string;
  text: string;
};

const reviews: Review[] = [
  {
    name: "Boddupally Hema",
    meta: "Hyderabad, Telangana",
    text: "Previously I was stuck somewhere in logic. After consistently following your pattern-wise sheet, I can now write code for arrays in both brute force and optimal — it's all because of you, sister. Love from Hyderabad.",
  },
  {
    name: "Harshit Pachauri",
    meta: "@harshitpachauri8849",
    text: "I came across your sheet — it's incredibly well-organised, based on patterns. Thank you for making it. I'm using it to master every pattern concept.",
  },
  {
    name: "Sai Pothuraju",
    meta: "@saipothuraju3847",
    text: "I've watched many DSA playlists, but I'd understand a concept and then forget how to solve the problem later. Your pattern-wise sheet is one of the best resources I've come across — it builds problem-solving step by step, with explanations that are easy to follow. I'd recommend the Rising Brain sheet to every beginner.",
  },
  {
    name: "Sruthi",
    meta: "Working professional",
    text: "I'm a working professional in a service-based company and not a CS/IT student, but this isn't difficult to learn from you. You're actually rising our brains.",
  },
  {
    name: "Rupendra Yadav",
    meta: "@RupendraYadav22",
    text: "Thank you so much ma'am — you're providing such wonderful content free of cost! Keep continuing; I'll pray to Krishna ji that all your wishes come true.",
  },
  {
    name: "Parth",
    meta: "@parthdeveloper2793",
    text: "Hello ma'am, your content and explanation are excellent!!",
  },
  {
    name: "Anshu Thakur",
    meta: "@anshu11thakur1",
    text: "I wanted to learn DSA in a way where I could identify patterns too. I searched, and I found this sheet — thank god.",
  },
  {
    name: "Priyanka",
    meta: "@Priyankakk",
    text: "Solved and submitted — thank you! Because of you I started doing DSA, and now I feel I can crack good companies too.",
  },
  {
    name: "Arpan Goyal",
    meta: "@Arpan-Goyal",
    text: "One thing I have to admire about the Rising Brain pattern-wise sheet — after learning a single problem from you, the next related one gets easily solved. Thank you for this sheet; it's boosting my confidence again.",
  },
  {
    name: "Jivas",
    meta: "@jus_jivas_things",
    text: "I just love your DSA sheet and your explanation, ma'am — cracked a startup with just your sheet within one month of prep.",
  },
  {
    name: "Pasunuti Sharan Teja",
    meta: "@PasunutiSharanteja",
    text: "I've been following your content for a long time, and your teaching has had a significant impact on my journey. Your explanations have strengthened my understanding and built my confidence and interest in problem-solving. Thank you, Anjali ma'am.",
  },
  {
    name: "Atharva Yadav",
    meta: "@Atharvayadav",
    text: "I started DSA from this sheet and already got an interview at a startup — and the best part is they asked questions straight from the sheet. The pattern-wise sheet helped me recognise patterns like nothing before.",
  },
  {
    name: "Riya Batra",
    meta: "@Riyabatra",
    text: "This is the best pattern-wise sheet I've come across — the questions are categorised in the way that's best for someone just starting with DSA. Thank you so much to Rising Brain and Anjali ma'am; this is the real one.",
  },
  {
    name: "Jayanth Latkari",
    meta: "@jashwanthlatkari1949",
    text: "Thank you so much for the Rising Brain DSA sheet — I've been following it consistently for a long time. Your teaching has given me a new perspective on consistency. Even on days I can't solve much, I tell myself, \"It's okay, let me solve at least one problem today.\" One problem a day compounds into 30 in a month. You always emphasise how small efforts compound over time — that's one of the biggest takeaways I've gained from you.",
  },
  {
    name: "Hari Hara",
    meta: "@mr_HariHara_03",
    text: "Thank you, ma'am. I've watched a lot of channels, but I stuck with your videos. I'm learning consistently — such a good way of explaining. Lots of love from us.",
  },
  {
    name: "Rahul Bhise",
    meta: "@rahulbhise2493",
    text: "Ma'am, you're better than my college teacher — the way you explain is stunning.",
  },
  {
    name: "Jittu",
    meta: "@jittuchinnu1418",
    text: "Thank you for the Rising Brain sheet — it's really helpful, and you're giving it to us completely free.",
  },
];

function ReviewCard({ r }: { r: Review }) {
  return (
    <div className="glass glass-hover flex w-[19rem] shrink-0 flex-col rounded-3xl p-6 sm:w-[21rem]">
      <Quote className="h-7 w-7 text-rb-green-500/40" />
      <blockquote className="mt-3 flex-1 text-sm leading-relaxed text-muted">“{r.text}”</blockquote>
      <div className="mt-5 flex items-center gap-3 border-t border-border pt-4">
        <Avatar name={r.name} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{r.name}</div>
          <div className="truncate text-xs text-accent">{r.meta}</div>
        </div>
        <div className="ml-auto self-start">
          <Stars />
        </div>
      </div>
    </div>
  );
}

/** One auto-scrolling row. The list is rendered twice so the loop is seamless. */
function MarqueeRow({ items, direction }: { items: Review[]; direction: "left" | "right" }) {
  return (
    <div className="flex w-max" style={{ animation: `${direction === "left" ? "rb-marq-l" : "rb-marq-r"} 120s linear infinite` }}>
      <div className="flex gap-5 pr-5" aria-hidden={false}>
        {items.map((r) => (
          <ReviewCard key={r.name} r={r} />
        ))}
      </div>
      <div className="flex gap-5 pr-5" aria-hidden>
        {items.map((r) => (
          <ReviewCard key={`${r.name}-dup`} r={r} />
        ))}
      </div>
    </div>
  );
}

export function Reviews() {
  return (
    <section id="reviews" className="py-16">
      {/* Scoped marquee animation — slow, seamless, pauses on hover. */}
      <style>{`
        @keyframes rb-marq-l { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @keyframes rb-marq-r { from { transform: translateX(-50%); } to { transform: translateX(0); } }
        .rb-marquee:hover [style*="rb-marq"] { animation-play-state: paused; }
        @media (prefers-reduced-motion: reduce) {
          .rb-marquee [style*="rb-marq"] { animation: none !important; }
        }
      `}</style>

      <Container>
        <div className="mb-10 text-center">
          <div className="mb-4">
            <Eyebrow>
              <span className="h-1.5 w-1.5 rounded-full bg-rb-green-400" />
              Loved by learners
            </Eyebrow>
          </div>
          <h2 className="text-2xl font-bold sm:text-3xl">
            What our <span className="text-gradient">students say</span>
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted">
            Real messages from learners following the RisingBrain pattern-wise sheet.
          </p>
        </div>
      </Container>

      {/* Full-bleed single-row marquee with soft edge fades. The vertical
          padding gives the cards' hover lift + shadow room inside the clipped
          container (otherwise overflow-hidden cuts off the top border on hover). */}
      <div
        className="rb-marquee relative overflow-hidden py-6"
        style={{
          maskImage:
            "linear-gradient(to right, transparent, black 6%, black 94%, transparent)",
          WebkitMaskImage:
            "linear-gradient(to right, transparent, black 6%, black 94%, transparent)",
        }}
      >
        <MarqueeRow items={reviews} direction="left" />
      </div>
    </section>
  );
}
